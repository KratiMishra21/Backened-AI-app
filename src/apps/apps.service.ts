import {
  Injectable,
  Logger,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { ConfigProcessorService } from './services/config-processor.service';
import { TableManagerService } from './services/table-manager.service';
import { ResponseHelper } from '../common/helpers/response.helper';
import { ApiResponse } from '../common/interfaces/api-response.interface';

@Injectable()
export class AppsService {
  private readonly logger = new Logger(AppsService.name);

  constructor(
    private prisma: PrismaService,
    private configProcessor: ConfigProcessorService,
    private tableManager: TableManagerService,
  ) {}

  async createApp(userId: string, rawConfig: any): Promise<ApiResponse<any>> {
    const processResult = this.configProcessor.process(rawConfig);

    // FAILED config — still save so user can see what went wrong
    if (processResult.status === 'FAILED') {
      const slug = await this.generateUniqueSlug(processResult.appName);
      await this.prisma.app.create({
        data: {
          name: processResult.appName,
          slug,
          rawConfig: rawConfig ?? {},
          parsedSchema: {},
          status: 'FAILED',
          warnings: processResult.errors,
          ownerId: userId,
        },
      });

      return ResponseHelper.error('Config validation failed', {
        errors: processResult.errors,
        warnings: processResult.warnings,
      });
    }

    // Generate unique slug
    const slug = await this.generateUniqueSlug(processResult.appName);

    // Create dynamic tables — use final slug-derived id placeholder
    // We need the app ID for table naming, so create app first then tables
    const app = await this.prisma.app.create({
      data: {
        name: processResult.appName,
        slug,
        rawConfig: rawConfig ?? {},
        parsedSchema: processResult.entities as any,
        status: processResult.status,
        warnings: processResult.warnings,
        ownerId: userId,
      },
    });

    const tableCreationResult = await this.tableManager.createTablesForApp(
      app.id,
      processResult.entities,
    );

    if (!tableCreationResult.success) {
      // Update app to FAILED
      await this.prisma.app.update({
        where: { id: app.id },
        data: {
          status: 'FAILED',
          warnings: [tableCreationResult.error || 'Failed to create tables'],
        },
      });

      return ResponseHelper.error(
        tableCreationResult.error || 'Failed to create dynamic tables',
        { appId: app.id },
      );
    }

    // Save entities
    const entities = await Promise.all(
      processResult.entities.map((entity) =>
        this.prisma.entity.create({
          data: {
            name: entity.name,
            tableName: tableCreationResult.tableMap![entity.name],
            schema: entity.fields as any,
            appId: app.id,
          },
        }),
      ),
    );

    this.logger.log(
      `Created app "${app.name}" (${app.slug}) for user ${userId} with ${entities.length} entities`,
    );

    return ResponseHelper.success(
      {
        app: {
          id: app.id,
          name: app.name,
          slug: app.slug,
          status: app.status,
          warnings: app.warnings,
          createdAt: app.createdAt,
        },
        entities: entities.map((e) => ({
          name: e.name,
          tableName: e.tableName,
          fields: e.schema,
        })),
      },
      processResult.warnings,
      { appId: app.id, entityCount: entities.length },
    );
  }

  async getApps(userId: string): Promise<ApiResponse<any>> {
    const apps = await this.prisma.app.findMany({
      where: { ownerId: userId },
      include: { entities: { select: { id: true } } },
      orderBy: { createdAt: 'desc' },
    });

    return ResponseHelper.success({
      apps: apps.map((app) => ({
        id: app.id,
        name: app.name,
        slug: app.slug,
        status: app.status,
        entityCount: app.entities.length,
        createdAt: app.createdAt,
      })),
    });
  }

  async getApp(userId: string, slug: string): Promise<ApiResponse<any>> {
    const app = await this.prisma.app.findUnique({
      where: { slug },
      include: { entities: true },
    });

    if (!app || app.ownerId !== userId) {
      throw new NotFoundException(`App with slug "${slug}" not found`);
    }

    return ResponseHelper.success({
      app: {
        id: app.id,
        name: app.name,
        slug: app.slug,
        status: app.status,
        warnings: app.warnings,
        createdAt: app.createdAt,
      },
      entities: app.entities.map((e) => ({
        id: e.id,
        name: e.name,
        tableName: e.tableName,
        fields: e.schema,
        createdAt: e.createdAt,
      })),
    });
  }

  async deleteApp(userId: string, slug: string): Promise<ApiResponse<any>> {
    const app = await this.prisma.app.findUnique({
      where: { slug },
      include: { entities: true },
    });

    if (!app || app.ownerId !== userId) {
      throw new NotFoundException(`App with slug "${slug}" not found`);
    }

    const tableNames = app.entities.map((e) => e.tableName);

    // Drop dynamic tables (never throws)
    await this.tableManager.dropTablesForApp(tableNames);

    // Cascade delete handles entities via Prisma schema
    await this.prisma.app.delete({ where: { id: app.id } });

    this.logger.log(`Deleted app "${app.name}" (${app.slug}) for user ${userId}`);

    return ResponseHelper.success({
      message: `App "${app.name}" deleted successfully`,
    });
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private generateSlug(appName: string): string {
    return appName
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'app';
  }

  private randomSuffix(): string {
    return Math.random().toString(36).substring(2, 8).padEnd(6, '0');
  }

  /**
   * Generates a unique slug by retrying up to 5 times on collision.
   */
  private async generateUniqueSlug(appName: string): Promise<string> {
    const base = this.generateSlug(appName);

    for (let attempt = 0; attempt < 5; attempt++) {
      const slug = `${base}-${this.randomSuffix()}`;
      const existing = await this.prisma.app.findUnique({ where: { slug } });
      if (!existing) return slug;
    }

    // Last resort: use timestamp
    return `${base}-${Date.now()}`;
  }
}
