import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import config from '../config.js'
import * as schema from './schema.js'

/**
 * Drizzle database client over the existing `DATABASE_URL`.
 *
 * Constructing the client has no side effects: `postgres(url)` opens no socket
 * at construction and only dials the database on the first query, so importing
 * this module never touches the network on its own.
 */
const queryClient = postgres(config.DATABASE_URL)

/** The shared Drizzle client. */
export const db = drizzle(queryClient, { schema })

/** Close the underlying connection (useful for graceful shutdown / tests). */
export async function closeDb(): Promise<void> {
  await queryClient.end()
}
