import { drizzle } from 'drizzle-orm/postgres-js'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import config from '../config.js'
import * as schema from './schema.js'

/**
 * Drizzle database client over the existing `DATABASE_URL`.
 *
 * The connection is created lazily on first access so importing this module has
 * no side effects — no socket is opened at module load. The underlying postgres
 * client itself only dials the database on the first query, but we additionally
 * defer constructing it so simply importing `db` never touches the network.
 */
let queryClient: ReturnType<typeof postgres> | undefined
let dbInstance: PostgresJsDatabase<typeof schema> | undefined

function getDb(): PostgresJsDatabase<typeof schema> {
  if (!dbInstance) {
    queryClient = postgres(config.DATABASE_URL)
    dbInstance = drizzle(queryClient, { schema })
  }
  return dbInstance
}

/**
 * The shared Drizzle client. Lazily initialised on first property access via a
 * Proxy, so `import { db } from './db/client.js'` opens no connection.
 */
export const db: PostgresJsDatabase<typeof schema> = new Proxy(
  {} as PostgresJsDatabase<typeof schema>,
  {
    get(_target, prop, receiver) {
      return Reflect.get(getDb(), prop, receiver)
    },
  },
)

/** Close the underlying connection (useful for graceful shutdown / tests). */
export async function closeDb(): Promise<void> {
  if (queryClient) {
    await queryClient.end()
    queryClient = undefined
    dbInstance = undefined
  }
}
