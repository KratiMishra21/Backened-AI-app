import {
  Injectable,
  BadRequestException,
  NotFoundException,
  InternalServerErrorException,
  Inject,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { Pool } from 'pg';
import { PG_POOL } from '../apps/providers/pg-pool.provider';
import { z } from 'zod';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_TABLE_NAME_REGEX = /^[a-z0-9_]+$/;

function buildZodSchema(fields: any[]) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const f of fields) {
    let s: z.ZodTypeAny;
    switch (f.type) {
      case 'string':
        s = z.string();
        break;
      case 'text':
        s = z.string();
        break;
      case 'number':
        s = z.number();
        break;
      case 'boolean':
        s = z.boolean();
        break;
      case 'date':
        s = z.string().refine((v) => !Number.isNaN(Date.parse(v)), {
          message: 'Invalid date string',
        });
        break;
      case 'enum':
        if (Array.isArray(f.values) && f.values.length > 0) {
          s = z.enum(f.values as [string, ...string[]]);
        } else {
          s = z.string();
        }
        break;
      default:
        s = z.string();
    }
    shape[f.name] = f.required ? s : s.optional();
  }
  return z.object(shape);
}

export interface CrudQuery {
  page?: string;
  limit?: string;
  sortBy?: string;
  sortOrder?: string;
}

@Injectable()
export class DynamicService {
  private readonly logger = new Logger(DynamicService.name);

  constructor(
    private prisma: PrismaService,
    @Inject(PG_POOL) private pgPool: Pool,
  ) {}

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private validateUuid(id: string, label = 'ID'): void {
    if (!UUID_REGEX.test(id)) {
      throw new BadRequestException(`Invalid ${label} format`);
    }
  }

  private validateTableName(tableName: string): void {
    if (!SAFE_TABLE_NAME_REGEX.test(tableName)) {
      throw new InternalServerErrorException('Invalid table name detected');
    }
  }

  private parsePagination(query: CrudQuery): {
    page: number;
    limit: number;
    offset: number;
    sortBy: string;
    sortOrder: 'ASC' | 'DESC';
  } {
    let page = parseInt(query.page ?? '1', 10);
    if (!page || page < 1) page = 1;

    let limit = parseInt(query.limit ?? '20', 10);
    if (!limit || limit < 1) limit = 20;
    if (limit > 100) limit = 100; // cap silently

    const offset = (page - 1) * limit;
    const sortBy = query.sortBy || 'created_at';
    const sortOrder =
      query.sortOrder?.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    return { page, limit, offset, sortBy, sortOrder };
  }

  private async resolveEntity(
    appSlug: string,
    entityName: string,
    userId?: string,
  ) {
    const app = await this.prisma.app.findUnique({ where: { slug: appSlug } });

    if (!app) {
      throw new NotFoundException(`App '${appSlug}' not found`);
    }

    // Enforce ownership when userId is provided
    if (userId && app.ownerId !== userId) {
      throw new NotFoundException(`App '${appSlug}' not found`);
    }

    const entity = await this.prisma.entity.findFirst({
      where: { appId: app.id, name: entityName },
    });

    if (!entity) {
      throw new NotFoundException(
        `Entity '${entityName}' not found in app '${appSlug}'`,
      );
    }

    this.validateTableName(entity.tableName);

    return { app, entity };
  }

  // -------------------------------------------------------------------------
  // CRUD operations
  // -------------------------------------------------------------------------

  async list(appSlug: string, entityName: string, query: CrudQuery, userId?: string) {
    const { entity } = await this.resolveEntity(appSlug, entityName, userId);
    const { page, limit, offset, sortBy, sortOrder } =
      this.parsePagination(query);

    // Validate sortBy against known fields + system columns
    const schema = entity.schema as any[];
    const allowedSortFields = [
      'created_at',
      'updated_at',
      ...schema.map((f: any) => f.name),
    ];
    const safeSortBy = allowedSortFields.includes(sortBy)
      ? sortBy
      : 'created_at';

    const client = await this.pgPool.connect();
    try {
      const [dataRes, countRes] = await Promise.all([
        client.query(
          `SELECT * FROM "${entity.tableName}" ORDER BY "${safeSortBy}" ${sortOrder} LIMIT $1 OFFSET $2`,
          [limit, offset],
        ),
        client.query(`SELECT COUNT(*) FROM "${entity.tableName}"`),
      ]);

      const total = parseInt(countRes.rows[0].count, 10);
      const totalPages = Math.ceil(total / limit);

      return {
        success: true,
        data: dataRes.rows,
        warnings: [],
        error: null,
        meta: { total, page, limit, totalPages },
      };
    } finally {
      client.release();
    }
  }

  async create(appSlug: string, entityName: string, body: any, userId?: string) {
    const { entity } = await this.resolveEntity(appSlug, entityName, userId);
    const schema = entity.schema as any[];
    const zodSchema = buildZodSchema(schema);

    // Validate — collect all errors at once
    const parsed = zodSchema.safeParse(body);
    if (!parsed.success) {
      const fieldErrors = parsed.error.errors.map((e) => ({
        field: e.path.join('.'),
        message: e.message,
      }));
      throw new BadRequestException({
        message: 'Validation failed',
        errors: fieldErrors,
      });
    }

    // Only use whitelisted fields from schema
    const allowedFields = schema.map((f: any) => f.name);
    const safeData = Object.fromEntries(
      Object.entries(parsed.data).filter(([k]) => allowedFields.includes(k)),
    );

    const columns = Object.keys(safeData);
    const values = Object.values(safeData);

    if (columns.length === 0) {
      // Insert with only system columns (all optional entity)
      const client = await this.pgPool.connect();
      try {
        const res = await client.query(
          `INSERT INTO "${entity.tableName}" DEFAULT VALUES RETURNING *`,
        );
        return { success: true, data: res.rows[0], warnings: [], error: null, meta: {} };
      } finally {
        client.release();
      }
    }

    const colsEscaped = columns.map((c) => `"${c}"`).join(', ');
    const params = values.map((_, i) => `$${i + 1}`).join(', ');
    const sql = `INSERT INTO "${entity.tableName}" (${colsEscaped}) VALUES (${params}) RETURNING *`;

    const client = await this.pgPool.connect();
    try {
      const res = await client.query(sql, values);
      return { success: true, data: res.rows[0], warnings: [], error: null, meta: {} };
    } finally {
      client.release();
    }
  }

  async getOne(appSlug: string, entityName: string, id: string, userId?: string) {
    this.validateUuid(id);
    const { entity } = await this.resolveEntity(appSlug, entityName, userId);

    const client = await this.pgPool.connect();
    try {
      const res = await client.query(
        `SELECT * FROM "${entity.tableName}" WHERE id = $1`,
        [id],
      );
      if (res.rows.length === 0) {
        throw new NotFoundException('Record not found');
      }
      return { success: true, data: res.rows[0], warnings: [], error: null, meta: {} };
    } finally {
      client.release();
    }
  }

  async update(appSlug: string, entityName: string, id: string, body: any, userId?: string) {
    this.validateUuid(id);
    const { entity } = await this.resolveEntity(appSlug, entityName, userId);

    // First verify record exists
    const client = await this.pgPool.connect();
    try {
      const existing = await client.query(
        `SELECT id FROM "${entity.tableName}" WHERE id = $1`,
        [id],
      );
      if (existing.rows.length === 0) {
        throw new NotFoundException('Record not found');
      }

      const schema = entity.schema as any[];
      const zodSchema = buildZodSchema(schema);
      const parsed = zodSchema.partial().safeParse(body);

      if (!parsed.success) {
        const fieldErrors = parsed.error.errors.map((e) => ({
          field: e.path.join('.'),
          message: e.message,
        }));
        throw new BadRequestException({
          message: 'Validation failed',
          errors: fieldErrors,
        });
      }

      // Whitelist fields
      const allowedFields = schema.map((f: any) => f.name);
      const safeData = Object.fromEntries(
        Object.entries(parsed.data).filter(
          ([k, v]) => allowedFields.includes(k) && v !== undefined,
        ),
      );

      if (Object.keys(safeData).length === 0) {
        throw new BadRequestException('No valid fields provided for update');
      }

      const entries = Object.entries(safeData);
      const setClauses = entries.map((e, i) => `"${e[0]}" = $${i + 1}`);
      // Always update updated_at
      setClauses.push(`updated_at = NOW()`);
      const values = entries.map((e) => e[1]);
      values.push(id);

      const sql = `UPDATE "${entity.tableName}" SET ${setClauses.join(', ')} WHERE id = $${values.length} RETURNING *`;
      const res = await client.query(sql, values);

      return { success: true, data: res.rows[0], warnings: [], error: null, meta: {} };
    } finally {
      client.release();
    }
  }

  async remove(appSlug: string, entityName: string, id: string, userId?: string) {
    this.validateUuid(id);
    const { entity } = await this.resolveEntity(appSlug, entityName, userId);

    const client = await this.pgPool.connect();
    try {
      const res = await client.query(
        `DELETE FROM "${entity.tableName}" WHERE id = $1 RETURNING id`,
        [id],
      );
      if (res.rows.length === 0) {
        throw new NotFoundException('Record not found');
      }
      return { success: true, data: null, warnings: [], error: null, meta: {} };
    } finally {
      client.release();
    }
  }
}
