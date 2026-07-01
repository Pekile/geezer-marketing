import { beforeEach, describe, expect, it, vi } from 'vitest'

// --- db client mock ---------------------------------------------------------
let existingRows: { id: number }[] = []
let campaignRows: Array<{ id: number; productId: string; status: string; copy: string | null }> = []

const limit = vi.fn(async () => existingRows)
const where = vi.fn(() => ({ limit }))
const from = vi.fn(() => ({ where }))
const select = vi.fn(() => ({ from }))

const insertReturning = vi.fn(async () => [{ id: existingRows.length + 1 }])
const insertValues = vi.fn((_vals: unknown) => {
  existingRows.push({ id: existingRows.length + 1 })
  return { returning: insertReturning }
})

function tableName(table: unknown): string {
  const sym = Object.getOwnPropertySymbols(table as object).find(
    s => s.description === 'drizzle:Name',
  )
  return sym ? String((table as Record<symbol, unknown>)[sym]) : String(table)
}

const recordedSends: Array<{ channel: string; status: string; errorMessage?: string }> = []
const sendValues = vi.fn(async (row: { channel: string; status: string; errorMessage?: string }) => {
  recordedSends.push(row)
})

const insert = vi.fn((table: unknown) => {
  if (tableName(table) === 'campaign_sends') return { values: sendValues }
  return { values: insertValues }
})

const updateWhere = vi.fn(async () => undefined)
const updateSet = vi.fn((_vals: unknown) => ({ where: updateWhere }))
const update = vi.fn(() => ({ set: updateSet }))

vi.mock('./db/client.js', () => ({
  db: {
    select: () => select(),
    insert: (table: unknown) => insert(table),
    update: () => update(),
  },
}))

// --- channel sender mocks ---------------------------------------------------
const sendEmail = vi.fn(async () => undefined)
const sendSms = vi.fn(async () => undefined)
const sendWhatsApp = vi.fn(async () => undefined)
const sendViber = vi.fn(async () => undefined)

vi.mock('./channels/email.js', () => ({ sendEmail: () => sendEmail() }))
vi.mock('./channels/sms.js', () => ({ sendSms: () => sendSms() }))
vi.mock('./channels/whatsapp.js', () => ({ sendWhatsApp: () => sendWhatsApp() }))
vi.mock('./channels/viber.js', () => ({ sendViber: () => sendViber() }))

// --- copy generator mock ----------------------------------------------------
// Batch version: takes (product, CustomerWithOrders[]) and returns CampaignCopy[]
const generateCampaignCopyBatch = vi.fn(async (_product: unknown, batch: unknown[]) =>
  batch.map(() => ({
    email: { subject: 'Subj', body: 'Body' },
    sms: { message: 'sms text' },
    whatsapp: { message: 'wa text' },
    viber: { message: 'viber text' },
  })),
)

vi.mock('./ai/generator.js', () => ({
  generateCampaignCopyBatch: (...a: unknown[]) => (generateCampaignCopyBatch as (...x: unknown[]) => Promise<unknown[]>)(...a),
}))

// --- shopify client mock ----------------------------------------------------
const getOptedInCustomers = vi.fn(async (): Promise<unknown[]> => [])
const getProduct = vi.fn(async () => product)

vi.mock('./shopify/client.js', () => ({
  getOptedInCustomers: () => getOptedInCustomers(),
  getProduct: () => getProduct(),
}))

import { generateCopiesForCampaign, recordCampaign } from './campaign.js'
import type { ShopifyProduct } from './shopify/types.js'

const product: ShopifyProduct = {
  id: 12345,
  title: 'Geezer Tee',
  body_html: '<p>nice</p>',
  handle: 'geezer-tee',
  images: [],
  variants: [{ price: '20.00' }],
}

describe('recordCampaign idempotency', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    existingRows = []
    campaignRows = []
    recordedSends.length = 0
  })

  it('skips when product already has a campaign', async () => {
    existingRows = [{ id: 1 }]

    const id = await recordCampaign(product)

    expect(id).toBeNull()
    expect(insert).not.toHaveBeenCalled()
  })

  it('inserts a pending campaign row when first-time', async () => {
    existingRows = []

    const id = await recordCampaign(product)

    expect(id).not.toBeNull()
    expect(insertValues).toHaveBeenCalledTimes(1)
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending' }),
    )
  })

  it('is idempotent — second call with same product returns null', async () => {
    existingRows = []

    const first = await recordCampaign(product)
    const second = await recordCampaign(product)

    expect(first).not.toBeNull()
    expect(second).toBeNull()
    expect(insertValues).toHaveBeenCalledTimes(1)
  })
})

describe('generateCopiesForCampaign draft behaviour', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    existingRows = []
    campaignRows = []
    recordedSends.length = 0
    // Default: select returns a full campaign row for generateCopiesForCampaign
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(limit as any).mockResolvedValue([{ id: 1, productId: '12345', productTitle: 'Geezer Tee', status: 'pending', copy: null }])
  })

  it('generates copy and stores it as a draft — never calls send functions', async () => {
    getOptedInCustomers.mockResolvedValueOnce([
      { id: 1, first_name: 'Marko', last_name: 'M', email: 'marko@example.com', phone: '+38160111', orders_count: 3 },
      { id: 2, first_name: 'Jovan', last_name: 'J', email: 'jovan@example.com', phone: null, orders_count: 0 },
    ])

    const count = await generateCopiesForCampaign(1)

    expect(count).toBe(2)

    // No channel sends — approval is a separate step
    expect(sendEmail).not.toHaveBeenCalled()
    expect(sendSms).not.toHaveBeenCalled()
    expect(sendWhatsApp).not.toHaveBeenCalled()
    expect(sendViber).not.toHaveBeenCalled()

    // Draft persisted via update setting status='draft' and the copy JSON
    expect(update).toHaveBeenCalledTimes(1)
    const arg = updateSet.mock.calls[0][0] as { status: string; copy: string }
    expect(arg.status).toBe('draft')

    const drafts = JSON.parse(arg.copy) as Array<Record<string, unknown>>
    expect(drafts).toHaveLength(2)
    expect(drafts[0]).toEqual({
      customerId: '1',
      firstName: 'Marko',
      email: 'marko@example.com',
      phone: '+38160111',
      email_subject: 'Subj',
      email_body: 'Body',
      sms: 'sms text',
      whatsapp: 'wa text',
      viber: 'viber text',
    })
    expect(drafts[1].phone).toBeNull()
  })
})
