import { beforeEach, describe, expect, it, vi } from 'vitest'

// --- db client mock ---------------------------------------------------------
// `existingRows` controls what the campaigns lookup returns: an empty array
// means the product has no campaign yet; a non-empty array means it already
// does and the run must be skipped.
let existingRows: { id: number }[] = []
const limit = vi.fn(async () => existingRows)
const where = vi.fn(() => ({ limit }))
const from = vi.fn(() => ({ where }))
const select = vi.fn(() => ({ from }))
// The insert appends a row to the same backing store the lookup reads, so a
// later run for the same product genuinely observes what an earlier run wrote
// — modelling the unique `product_id` row the real `campaigns` table holds.
const insertReturning = vi.fn(async () => [{ id: existingRows.length }])
const insertValues = vi.fn((_vals: unknown) => {
  existingRows.push({ id: existingRows.length + 1 })
  return { returning: insertReturning }
})
const insert = vi.fn(() => ({ values: insertValues }))

// The draft store: runCampaign ends with db.update(...).set({copy,status}).where(...).
const updateWhere = vi.fn(async () => undefined)
const updateSet = vi.fn((_vals: unknown) => ({ where: updateWhere }))
const update = vi.fn(() => ({ set: updateSet }))

vi.mock('./db/client.js', () => ({
  db: {
    select: () => select(),
    insert: () => insert(),
    update: () => update(),
  },
}))

// --- collaborators mock -----------------------------------------------------
const getOptedInCustomers = vi.fn(async (): Promise<unknown[]> => [])
const getCustomerOrders = vi.fn(async (_id: number) => [])

vi.mock('./shopify/client.js', () => ({
  getOptedInCustomers: () => getOptedInCustomers(),
  getCustomerOrders: (id: number) => getCustomerOrders(id),
}))

// AI copy generator — return deterministic copy so the draft shape is testable.
const generateCampaignCopy = vi.fn(async () => ({
  email: { subject: 'Subj', body: 'Body' },
  sms: { message: 'sms text' },
  whatsapp: { message: 'wa text' },
  viber: { message: 'viber text' },
}))

vi.mock('./ai/generator.js', () => ({
  generateCampaignCopy: () => generateCampaignCopy(),
}))

// The four channel senders must never be called by runCampaign — sending only
// happens at approval time (api/approve.ts).
const sendEmail = vi.fn(async () => undefined)
const sendSms = vi.fn(async () => undefined)
const sendWhatsApp = vi.fn(async () => undefined)
const sendViber = vi.fn(async () => undefined)

vi.mock('./channels/email.js', () => ({ sendEmail: () => sendEmail() }))
vi.mock('./channels/sms.js', () => ({ sendSms: () => sendSms() }))
vi.mock('./channels/whatsapp.js', () => ({ sendWhatsApp: () => sendWhatsApp() }))
vi.mock('./channels/viber.js', () => ({ sendViber: () => sendViber() }))

import { runCampaign } from './campaign.js'
import type { ShopifyProduct } from './shopify/types.js'

const product: ShopifyProduct = {
  id: 12345,
  title: 'Geezer Tee',
  body_html: '<p>nice</p>',
  handle: 'geezer-tee',
  images: [],
  variants: [{ price: '20.00' }],
}

describe('runCampaign idempotency', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    existingRows = []
  })

  it('skips the campaign and sends nothing when the product already has a campaign', async () => {
    existingRows = [{ id: 1 }]

    await runCampaign(product)

    // Looked up by productId, found a row, returned early.
    expect(select).toHaveBeenCalledTimes(1)
    expect(insert).not.toHaveBeenCalled()
    expect(getOptedInCustomers).not.toHaveBeenCalled()
  })

  it('inserts a campaign row and proceeds when the product is first-time', async () => {
    existingRows = []

    await runCampaign(product)

    expect(select).toHaveBeenCalledTimes(1)
    expect(insert).toHaveBeenCalledTimes(1)
    expect(insertValues).toHaveBeenCalledWith({
      productId: '12345',
      productTitle: 'Geezer Tee',
    })
    // Proceeded into the existing send logic.
    expect(getOptedInCustomers).toHaveBeenCalledTimes(1)
  })

  it('re-delivering the same product creates no second record and sends nothing on the second run', async () => {
    existingRows = []

    // First delivery: records the product and runs the campaign.
    await runCampaign(product)
    // Second delivery of the same webhook: the record from the first run is now
    // present, so the run is skipped — no second insert, no further sends.
    await runCampaign(product)

    // Two lookups (one per delivery), but exactly one record was ever inserted.
    expect(select).toHaveBeenCalledTimes(2)
    expect(insert).toHaveBeenCalledTimes(1)
    expect(insertValues).toHaveBeenCalledTimes(1)
    expect(existingRows).toHaveLength(1)
    // The send loop ran for the first delivery only.
    expect(getOptedInCustomers).toHaveBeenCalledTimes(1)
  })
})

describe('runCampaign draft behaviour', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    existingRows = []
  })

  it('stores generated copy as a draft and never calls a send function', async () => {
    getOptedInCustomers.mockResolvedValueOnce([
      { id: 1, first_name: 'Marko', last_name: 'M', email: 'marko@example.com', phone: '+38160111' },
      { id: 2, first_name: 'Jovan', last_name: 'J', email: 'jovan@example.com', phone: null },
    ])

    await runCampaign(product)

    // No channel send happened — approval is a separate step.
    expect(sendEmail).not.toHaveBeenCalled()
    expect(sendSms).not.toHaveBeenCalled()
    expect(sendWhatsApp).not.toHaveBeenCalled()
    expect(sendViber).not.toHaveBeenCalled()

    // The draft was persisted via a single update setting status='draft' and the
    // serialised per-customer copy array.
    expect(update).toHaveBeenCalledTimes(1)
    expect(updateSet).toHaveBeenCalledTimes(1)
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
    // Customer 2 has no phone — captured as null, copy still generated.
    expect(drafts[1].phone).toBeNull()
  })
})
