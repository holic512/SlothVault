/**
 * @file types.ts
 * @project SlothVault
 * @module Database Bootstrap
 * @description Defines the provider, connection, installation, and public status contracts shared by the installer and database runtime.
 * @logic Keep provider-specific secrets in a discriminated union while exposing only masked summaries outside the server configuration boundary.
 * @dependencies zod
 * @index_tags database,provider,installer,configuration,types
 * @author holic512
 */
import { z } from 'zod'

export const databaseProviderSchema = z.enum(['sqlite', 'mysql', 'postgresql'])
export type DatabaseProvider = z.infer<typeof databaseProviderSchema>

const caPemSchema = z
  .string()
  .trim()
  .max(64 * 1024)
  .optional()
  .transform((value) => value || undefined)

const serverConnectionSchema = z.object({
  host: z.string().trim().min(1).max(255),
  port: z.number().int().min(1).max(65_535),
  database: z.string().trim().min(1).max(128),
  username: z.string().trim().min(1).max(128),
  password: z.string().min(1).max(4_096),
  tlsEnabled: z.boolean().default(false),
  caPem: caPemSchema,
})

export const databaseConnectionInputSchema = z.discriminatedUnion('provider', [
  z.object({ provider: z.literal('sqlite'), config: z.object({}).strict() }),
  z.object({ provider: z.literal('mysql'), config: serverConnectionSchema }),
  z.object({ provider: z.literal('postgresql'), config: serverConnectionSchema }),
])

export type DatabaseConnectionInput = z.infer<typeof databaseConnectionInputSchema>
export type ServerDatabaseConnection = Extract<
  DatabaseConnectionInput,
  { provider: 'mysql' | 'postgresql' }
>['config']

export const installationStatusSchema = z.enum([
  'UNCONFIGURED',
  'CONFIGURING',
  'SCHEMA_READY',
  'INSTALLED',
  'MAINTENANCE',
])
export type InstallationStatus = z.infer<typeof installationStatusSchema>

export const storedDatabaseConfigurationSchema = z
  .object({
    version: z.literal(1),
    status: z.enum(['CONFIGURING', 'SCHEMA_READY', 'INSTALLED']),
    provider: databaseProviderSchema,
    connection: databaseConnectionInputSchema,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .superRefine((value, context) => {
    if (value.provider !== value.connection.provider) {
      context.addIssue({
        code: 'custom',
        path: ['connection', 'provider'],
        message: 'Stored database provider does not match its connection payload',
      })
    }
  })

export type StoredDatabaseConfiguration = z.infer<typeof storedDatabaseConfigurationSchema>

export type InstallationPublicStatus = {
  status: InstallationStatus
  provider: DatabaseProvider | null
  database?: string
  host?: string
  error?: string
}
