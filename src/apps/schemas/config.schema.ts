import { z } from 'zod';

// Supported field types
export const FIELD_TYPES = [
  'string',
  'number',
  'boolean',
  'date',
  'enum',
  'text',
] as const;

// Field name regex: alphanumeric + underscore, cannot start with number
const FIELD_NAME_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

// Entity name regex: alphanumeric only, cannot start with number
const ENTITY_NAME_REGEX = /^[a-zA-Z][a-zA-Z0-9]*$/;

// ============================================================================
// Field Schema
// ============================================================================

export const FieldSchema = z.object({
  name: z
    .string()
    .min(1, 'Field name is required')
    .regex(
      FIELD_NAME_REGEX,
      'Field name must start with letter or underscore and contain only alphanumeric characters and underscores',
    ),
  type: z.enum(FIELD_TYPES, {
    errorMap: () => ({
      message: `Field type must be one of: ${FIELD_TYPES.join(', ')}`,
    }),
  }),
  required: z.boolean().optional().default(false),
  values: z.array(z.string()).optional(),
});

// ============================================================================
// Entity Schema
// ============================================================================

export const EntitySchema = z.object({
  name: z
    .string()
    .min(1, 'Entity name is required')
    .regex(
      ENTITY_NAME_REGEX,
      'Entity name must start with a letter and contain only alphanumeric characters',
    ),
  fields: z
    .array(FieldSchema)
    .min(1, 'At least one field is required'),
});

// ============================================================================
// App Config Schema
// ============================================================================

export const AppConfigSchema = z.object({
  appName: z
    .string()
    .optional()
    .transform((val) => val || 'Untitled App'),
  entities: z
    .array(EntitySchema)
    .min(1, 'At least one entity is required'),
});

// ============================================================================
// TypeScript Type Definitions
// ============================================================================

export type FieldType = z.infer<typeof FieldSchema>;
export type EntityType = z.infer<typeof EntitySchema>;
export type AppConfigType = z.infer<typeof AppConfigSchema>;
