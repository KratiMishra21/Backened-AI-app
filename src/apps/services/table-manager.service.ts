import { Injectable, Inject, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { ProcessedEntity } from './config-processor.service';
import { PG_POOL } from '../providers/pg-pool.provider';

export interface TableCreationResult {
  success: boolean;
  tableMap?: Record<string, string>;
  error?: string;
}

type FieldTypeMapping = {
  string: string;
  number: string;
  boolean: string;
  date: string;
  enum: string;
  text: string;
};

const FIELD_TYPE_MAPPING: FieldTypeMapping = {
  string: 'VARCHAR(255)',
  text: 'TEXT',
  number: 'NUMERIC',
  boolean: 'BOOLEAN',
  date: 'TIMESTAMP',
  enum: 'VARCHAR(100)',
};

@Injectable()
export class TableManagerService {
  private readonly logger = new Logger(TableManagerService.name);

  constructor(@Inject(PG_POOL) private pgPool: Pool) {}

  async createTablesForApp(
    appId: string,
    entities: ProcessedEntity[],
  ): Promise<TableCreationResult> {
    const client = await this.pgPool.connect();

    try {
      // Generate table names and build SQL statements
      const tableMap: Record<string, string> = {};
      const createTableStatements: string[] = [];

      for (const entity of entities) {
        const tableName = this.generateTableName(appId, entity.name);
        tableMap[entity.name] = tableName;

        const createTableSQL = this.buildCreateTableSQL(tableName, entity);
        createTableStatements.push(createTableSQL);
      }

      // Execute all CREATE TABLE statements in a transaction
      await client.query('BEGIN');

      try {
        for (const sql of createTableStatements) {
          await client.query(sql);
        }

        await client.query('COMMIT');

        this.logger.log(
          `Successfully created ${createTableStatements.length} tables for app ${appId}`,
        );

        return {
          success: true,
          tableMap,
        };
      } catch (error) {
        await client.query('ROLLBACK');
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';
        this.logger.error(
          `Failed to create tables for app ${appId}: ${errorMessage}`,
          error instanceof Error ? error.stack : '',
        );
        return {
          success: false,
          error: `Failed to create tables: ${errorMessage}`,
        };
      }
    } finally {
      client.release();
    }
  }

  async dropTablesForApp(tableNames: string[]): Promise<void> {
    if (tableNames.length === 0) {
      return;
    }

    const client = await this.pgPool.connect();

    try {
      await client.query('BEGIN');

      try {
        for (const tableName of tableNames) {
          const dropSQL = `DROP TABLE IF EXISTS "${tableName}" CASCADE;`;
          await client.query(dropSQL);
        }

        await client.query('COMMIT');
        this.logger.log(`Successfully dropped ${tableNames.length} tables`);
      } catch (error) {
        await client.query('ROLLBACK');
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';
        this.logger.error(
          `Failed to drop tables: ${errorMessage}`,
          error instanceof Error ? error.stack : '',
        );
        // Never throw, just log
      }
    } finally {
      client.release();
    }
  }

  // =========================================================================
  // Helper Methods
  // =========================================================================

  private generateTableName(appId: string, entityName: string): string {
    // Shorten appId to first 8 characters
    const shortAppId = appId.substring(0, 8);
    // Convert entity name to lowercase
    const lowerEntityName = entityName.toLowerCase();
    return `dyn_${shortAppId}_${lowerEntityName}`;
  }

  private buildCreateTableSQL(
    tableName: string,
    entity: ProcessedEntity,
  ): string {
    const columns: string[] = [];

    // System columns
    columns.push('id UUID PRIMARY KEY DEFAULT gen_random_uuid()');
    columns.push('created_at TIMESTAMP DEFAULT NOW()');
    columns.push('updated_at TIMESTAMP DEFAULT NOW()');

    // User-defined fields
    for (const field of entity.fields) {
      const postgresType = FIELD_TYPE_MAPPING[field.type as keyof FieldTypeMapping] || 'VARCHAR(255)';
      const notNull = field.required ? ' NOT NULL' : '';
      const columnDef = `"${field.name}" ${postgresType}${notNull}`;
      columns.push(columnDef);
    }

    const columnDefinitions = columns.join(', ');
    const sql = `CREATE TABLE IF NOT EXISTS "${tableName}" (${columnDefinitions});`;

    return sql;
  }
}
