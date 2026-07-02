import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

// --- db mock ----------------------------------------------------------------
// `campaignRow` is what the id lookup returns (undefined => not found). The
// update chain records the values it was set to.
let campaignRow: Record<string, unknown> | undefined
const selectLimit = vi.fn(async () => (campaignRow ? [campaignRow] : []))
const selectWhere = vi.fn(() => ({ limit: selectLimit }))
const selectFrom = vi.fn(() => ({ where: selectWhere }))
const select = vi.fn(() => ({ from: selectFrom }))

const updateWhere = vi.fn(async () => undefined)
const updateSet = vi.fn((_vals: unknown) => ({ where: updateWhere }))
const update = vi.fn(() => ({ set: updateSet }))

vi.mock('../src/db/client.js', () => ({
  db: { select: () => select(), update: () => update() },
}))

// --- channel + logSend mocks ------------------------------------------------
const sendEmail = vi.fn(async () => undefined)
const sendSms = vi.fn(async () => undefined)
const sendWhatsApp = vi.fn(async () => undefined)
const sendViber = vi.fn(async () => undefined)

vi.mock('../src/channels/email.js', () => ({ sendEmail: (...a: unknown[]) => sendEmail(...a) }))
vi.mock('../src/channels/sms.js', () => ({ sendSms: (...a: unknown[]) => sendSms(...a) }))
vi.mock('../src/channels/whatsapp.js', () => ({ sendWhatsApp: (...a: unknown[]) => sendWhatsApp(...a) }))
vi.mock('../src/channels/viber.js', () => ({ sendViber: (...a: unknown[]) => sendViber(...a) }))

// logSend is the real helper's contract: run the send fn. We mock it to just
// invoke the fn so we observe which channels fired without touching the DB.
// `channelsFor` (the fan-out rule) is kept as the real implementation so the
// handler drives dispatch from the single source of truth; it calls the mocked
// channel senders above.
const logSend = vi.fn(async (_c: number, _id: string, _ch: string, fn: () => Promise<void>) => { await fn() })
vi.mock('../src/campaign.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/campaign.js')>()
  return {
    ...actual,
    logSend: (...a: unknown[]) => (logSend as (...x: unknown[]) => Promise<void>)(...a),
  }
})

// config: no DASHBOARD_SECRET so auth is skipped.
vi.mock('../src/config.js', () => ({ default: { DASHBOARD_SECRET: '' } }))

import handler from './approve.js'

function mockReq(method: string, id?: string): VercelRequest {
  return { method, query: id === undefined ? {} : { id }, headers: {} } as unknown as VercelRequest
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
    email_subject: 'S', email_body: 'B', sms: 'sms', whatsapp: 'wa', viber: 'vb',
  },
  {
    customerId: '2', firstName: 'Jovan', email: 'jovan@example.com', phone: null,
    email_subject: 'S2', email_body: 'B2', sms: 'sms2', whatsapp: 'wa2', viber: 'vb2',
  },
])

describe('POST /api/approve', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    campaignRow = undefined
  })

  it('rejects non-POST methods with 405', async () => {
    const res = mockRes()
    await handler(mockReq('GET', '1'), res)
    expect(res._status).toBe(405)
  })

  it('returns 400 when id is missing or invalid', async () => {
    const res = mockRes()
    await handler(mockReq('POST'), res)
    expect(res._status).toBe(400)
  })

  it('returns 404 when the campaign does not exist', async () => {
    campaignRow = undefined
    const res = mockRes()
    await handler(mockReq('POST', '99'), res)
    expect(res._status).toBe(404)
  })

  it('returns 400 when the campaign is already sent', async () => {
    campaignRow = { id: 1, status: 'sent', copy: draftCopy }
    const res = mockRes()
    await handler(mockReq('POST', '1'), res)
    expect(res._status).toBe(400)
    expect(update).not.toHaveBeenCalled()
  })

  it('sends the stored copy, marks the campaign sent, and returns the count', async () => {
    campaignRow = { id: 1, status: 'draft', copy: draftCopy }
    const res = mockRes()
    await handler(mockReq('POST', '1'), res)

    // Customer 1 (email + phone): all 4 channels. Customer 2 (email only): email.
    expect(sendEmail).toHaveBeenCalledTimes(2)
    expect(sendSms).toHaveBeenCalledTimes(1)
    expect(sendWhatsApp).toHaveBeenCalledTimes(1)
    expect(sendViber).toHaveBeenCalledTimes(1)

    // Sends went through the shared logSend helper.
    expect(logSend).toHaveBeenCalled()

    // Status flipped to 'sent'.
    expect(updateSet).toHaveBeenCalledWith({ status: 'sent' })

    expect(res._json).toEqual({ ok: true, sent: 2, testMode: false })
  })

  it('returns 400 when stored copy is not valid JSON', async () => {
    campaignRow = { id: 1, status: 'draft', copy: 'not json' }
    const res = mockRes()
    await handler(mockReq('POST', '1'), res)
    expect(res._status).toBe(400)
  })
})
