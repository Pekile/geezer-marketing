import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

// --- db mock ----------------------------------------------------------------
// The handler runs two selects: the campaign list (ordered + limited) and the
// send-stats aggregate (grouped). We route the two chains off distinct shapes
// so each returns its own rows.
let campaignRows: Record<string, unknown>[] = []
let statsRows: Record<string, unknown>[] = []

const listLimit = vi.fn(async () => campaignRows)
const listOrderBy = vi.fn(() => ({ limit: listLimit }))
const listFrom = vi.fn(() => ({ orderBy: listOrderBy }))

const statsGroupBy = vi.fn(async () => statsRows)
const statsFrom = vi.fn(() => ({ groupBy: statsGroupBy }))

// First `select()` (no args) is the campaign list; the second (`select({...})`)
// is the aggregate. Distinguish by whether a projection object was passed.
const select = vi.fn((projection?: unknown) =>
  projection ? { from: statsFrom } : { from: listFrom },
)

vi.mock('../src/db/client.js', () => ({
  db: { select: (p?: unknown) => select(p) },
}))

// config: no DASHBOARD_SECRET so auth is skipped.
vi.mock('../src/config.js', () => ({ default: { DASHBOARD_SECRET: '' } }))

import handler from './dashboard.js'

function mockReq(method: string): VercelRequest {
  return { method, query: {}, headers: {} } as unknown as VercelRequest
}

function mockRes(): VercelResponse & { _status: number; _json: unknown } {
  const res = {
    _status: 200,
    _json: undefined as unknown,
    setHeader: vi.fn(),
    status(code: number) { this._status = code; return this },
    json(body: unknown) { this._json = body; return this },
    send(body: unknown) { this._json = body; return this },
  }
  return res as unknown as VercelResponse & { _status: number; _json: unknown }
}

const draftCopy = JSON.stringify([
  {
    customerId: '1', firstName: 'Marko', email: 'marko@example.com', phone: '+38160111',
    email_subject: 'Novi proizvod', email_body: 'Zdravo Marko', sms: 'sms', whatsapp: 'wa', viber: 'vb',
  },
])

describe('GET /api/dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    campaignRows = []
    statsRows = []
  })

  it('rejects non-GET methods with 405', async () => {
    const res = mockRes()
    await handler(mockReq('POST'), res)
    expect(res._status).toBe(405)
  })

  it('includes status and copy on each campaign in the response', async () => {
    campaignRows = [
      { id: 1, productId: 'p1', productTitle: 'T1', status: 'draft', copy: draftCopy, createdAt: new Date().toISOString() },
      { id: 2, productId: 'p2', productTitle: 'T2', status: 'sent', copy: null, createdAt: new Date().toISOString() },
    ]
    statsRows = [
      { campaignId: 2, channel: 'email', status: 'sent', count: 3 },
    ]

    const res = mockRes()
    await handler(mockReq('GET'), res)

    const body = res._json as { campaigns: Record<string, unknown>[] }
    const draft = body.campaigns.find(c => c.id === 1)!
    const sent = body.campaigns.find(c => c.id === 2)!

    expect(draft.status).toBe('draft')
    expect(draft.copy).toBe(draftCopy)
    expect(sent.status).toBe('sent')
    expect(sent.copy).toBeNull()
  })

  it('still computes send stats alongside status/copy', async () => {
    campaignRows = [
      { id: 1, productId: 'p1', productTitle: 'T1', status: 'sent', copy: null, createdAt: new Date().toISOString() },
    ]
    statsRows = [
      { campaignId: 1, channel: 'email', status: 'sent', count: 2 },
      { campaignId: 1, channel: 'sms', status: 'failed', count: 1 },
    ]

    const res = mockRes()
    await handler(mockReq('GET'), res)

    const body = res._json as {
      stats: { totalSends: number; totalSent: number }
      campaigns: Record<string, unknown>[]
    }
    expect(body.stats.totalSends).toBe(3)
    expect(body.stats.totalSent).toBe(2)
    expect(body.campaigns[0].totalSent).toBe(2)
    expect(body.campaigns[0].totalFailed).toBe(1)
  })
})
