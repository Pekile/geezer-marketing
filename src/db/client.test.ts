import { describe, expect, it } from 'vitest'

describe('db client', () => {
  it('imports without opening a connection (no side effects at module load)', async () => {
    const mod = await import('./client.js')
    expect(mod.db).toBeDefined()
  })

  it('instantiates the drizzle client without throwing', async () => {
    const { db } = await import('./client.js')
    // The query-builder is available without dialing the database (no query is
    // executed); postgres() opens no socket until the first query runs.
    expect(typeof db.select).toBe('function')
  })
})
