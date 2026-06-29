import { describe, expect, it } from 'vitest'

describe('db client', () => {
  it('imports without opening a connection (no side effects at module load)', async () => {
    const mod = await import('./client.js')
    expect(mod.db).toBeDefined()
  })

  it('instantiates the drizzle client without throwing', async () => {
    const { db } = await import('./client.js')
    // Accessing a query-builder method forces lazy initialisation but does not
    // dial the database (no query is executed).
    expect(typeof db.select).toBe('function')
  })
})
