import { Injectable, Logger } from '@nestjs/common';
import { FIELD_TYPES } from '../schemas/config.schema';

export interface ProcessedField {
  name: string;
  type: string;
  required: boolean;
  values?: string[];
}

export interface ProcessedEntity {
  name: string;
  fields: ProcessedField[];
}

export interface ConfigProcessResult {
  success: boolean;
  appName: string;
  entities: ProcessedEntity[];
  warnings: string[];
  errors: string[];
  status: 'ACTIVE' | 'DEGRADED' | 'FAILED';
}

const RESERVED_FIELD_NAMES = ['id', 'created_at', 'updated_at'];
const FIELD_NAME_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const ENTITY_NAME_REGEX = /^[a-zA-Z][a-zA-Z0-9]*$/;
const MAX_APP_NAME_LENGTH = 100;
const MAX_FIELDS_PER_ENTITY = 50;
const MAX_ENTITIES = 20;

@Injectable()
export class ConfigProcessorService {
  private readonly logger = new Logger(ConfigProcessorService.name);

  process(input: unknown): ConfigProcessResult {
    const warnings: string[] = [];
    const errors: string[] = [];
    let appName = 'Untitled App';
    let entities: any[] = [];

    // Stage 1: Parse and Sanitize
    const stage1Result = this.stageParseAndSanitize(input);
    if (!stage1Result.success) {
      return {
        success: false,
        appName: 'Untitled App',
        entities: [],
        warnings: [],
        errors: stage1Result.errors,
        status: 'FAILED',
      };
    }

    appName = stage1Result.appName;
    entities = stage1Result.entities;
    warnings.push(...stage1Result.warnings);

    // Stage 2: Field Normalization
    const stage2Result = this.stageFieldNormalization(entities);
    entities = stage2Result.entities;
    warnings.push(...stage2Result.warnings);

    // Stage 3: Entity Validation
    const stage3Result = this.stageEntityValidation(entities);
    entities = stage3Result.entities;
    warnings.push(...stage3Result.warnings);

    // Stage 4: Final Check
    if (entities.length === 0) {
      return {
        success: false,
        appName,
        entities: [],
        warnings,
        errors: ['No valid entities remain after processing'],
        status: 'FAILED',
      };
    }

    // Stage 5: Determine Status
    const status: 'ACTIVE' | 'DEGRADED' | 'FAILED' =
      warnings.length > 0 ? 'DEGRADED' : 'ACTIVE';

    return {
      success: true,
      appName,
      entities,
      warnings,
      errors,
      status,
    };
  }

  // ---------------------------------------------------------------------------
  // Stage 1: Parse and Sanitize
  // ---------------------------------------------------------------------------
  private stageParseAndSanitize(input: unknown): {
    success: boolean;
    appName: string;
    entities: any[];
    warnings: string[];
    errors: string[];
  } {
    const warnings: string[] = [];
    const errors: string[] = [];

    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      errors.push('Config must be a JSON object');
      return { success: false, appName: 'Untitled App', entities: [], warnings, errors };
    }

    const config = input as Record<string, unknown>;

    // appName handling
    let appName = 'Untitled App';
    if (config.appName !== undefined) {
      if (typeof config.appName === 'string' && config.appName.trim()) {
        appName = config.appName.trim();
        // Prompt 14: truncate long app names
        if (appName.length > MAX_APP_NAME_LENGTH) {
          appName = appName.substring(0, MAX_APP_NAME_LENGTH);
          warnings.push(
            `appName was truncated to ${MAX_APP_NAME_LENGTH} characters`,
          );
        }
      } else {
        warnings.push('appName is missing or empty, defaulted to "Untitled App"');
      }
    }

    if (!config.entities || !Array.isArray(config.entities)) {
      errors.push('Config must contain an entities array');
      return { success: false, appName, entities: [], warnings, errors };
    }

    if (config.entities.length === 0) {
      errors.push('Config must contain at least one entity');
      return { success: false, appName, entities: [], warnings, errors };
    }

    // Prompt 14: limit to MAX_ENTITIES
    let entities = config.entities;
    if (entities.length > MAX_ENTITIES) {
      warnings.push(
        `Config contains more than ${MAX_ENTITIES} entities — only the first ${MAX_ENTITIES} will be processed`,
      );
      entities = entities.slice(0, MAX_ENTITIES);
    }

    return { success: true, appName, entities, warnings, errors };
  }

  // ---------------------------------------------------------------------------
  // Stage 2: Field Normalization
  // ---------------------------------------------------------------------------
  private stageFieldNormalization(entities: any[]): {
    entities: ProcessedEntity[];
    warnings: string[];
  } {
    const warnings: string[] = [];
    const processedEntities: ProcessedEntity[] = [];

    for (const entity of entities) {
      if (!entity || typeof entity !== 'object') {
        continue;
      }

      const entityName = entity.name;
      const rawFields = Array.isArray(entity.fields) ? entity.fields : [];
      const processedFields: ProcessedField[] = [];
      const seenFieldNames = new Set<string>();

      // Prompt 14: cap fields per entity
      let fieldsToProcess = rawFields;
      if (fieldsToProcess.length > MAX_FIELDS_PER_ENTITY) {
        warnings.push(
          `Entity '${entityName}' has more than ${MAX_FIELDS_PER_ENTITY} fields — only the first ${MAX_FIELDS_PER_ENTITY} will be used`,
        );
        fieldsToProcess = fieldsToProcess.slice(0, MAX_FIELDS_PER_ENTITY);
      }

      for (const field of fieldsToProcess) {
        if (!field || typeof field !== 'object') continue;

        const fieldName = field.name;
        let fieldType = field.type;

        // Reserved names
        if (RESERVED_FIELD_NAMES.includes(fieldName)) {
          warnings.push(
            `Field '${fieldName}' in entity '${entityName}' is reserved and was removed`,
          );
          continue;
        }

        // Invalid name format
        if (!FIELD_NAME_REGEX.test(fieldName)) {
          warnings.push(
            `Field '${fieldName}' in entity '${entityName}' has invalid name and was removed`,
          );
          continue;
        }

        // Duplicates
        if (seenFieldNames.has(fieldName)) {
          warnings.push(
            `Duplicate field '${fieldName}' in entity '${entityName}' was removed`,
          );
          continue;
        }
        seenFieldNames.add(fieldName);

        // Unknown type → coerce to string
        if (!FIELD_TYPES.includes(fieldType)) {
          warnings.push(
            `Field '${fieldName}' in entity '${entityName}' has unknown type '${fieldType}', defaulted to string`,
          );
          fieldType = 'string';
        }

        const required =
          typeof field.required === 'boolean' ? field.required : false;

        // Enum without values → coerce to string
        let values = field.values;
        if (fieldType === 'enum') {
          if (!Array.isArray(values) || values.length === 0) {
            warnings.push(
              `Field '${fieldName}' in entity '${entityName}' is enum type but has no values, converted to string`,
            );
            fieldType = 'string';
            values = undefined;
          }
        }

        processedFields.push({
          name: fieldName,
          type: fieldType,
          required,
          ...(values && { values }),
        });
      }

      processedEntities.push({ name: entityName, fields: processedFields });
    }

    return { entities: processedEntities, warnings };
  }

  // ---------------------------------------------------------------------------
  // Stage 3: Entity Validation
  // ---------------------------------------------------------------------------
  private stageEntityValidation(entities: ProcessedEntity[]): {
    entities: ProcessedEntity[];
    warnings: string[];
  } {
    const warnings: string[] = [];
    const validEntities: ProcessedEntity[] = [];
    const seenEntityNames = new Set<string>();

    for (const entity of entities) {
      const entityName = entity.name;

      if (!ENTITY_NAME_REGEX.test(entityName)) {
        warnings.push(`Entity '${entityName}' has invalid name and was skipped`);
        continue;
      }

      if (seenEntityNames.has(entityName)) {
        warnings.push(`Duplicate entity '${entityName}' was removed`);
        continue;
      }

      if (entity.fields.length === 0) {
        warnings.push(
          `Entity '${entityName}' has no valid fields and was skipped`,
        );
        continue;
      }

      seenEntityNames.add(entityName);
      validEntities.push(entity);
    }

    return { entities: validEntities, warnings };
  }
}
