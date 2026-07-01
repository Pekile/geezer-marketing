import { beforeEach, describe, expect, it, vi } from 'vitest'

// --- db client mock ---------------------------------------------------------
let existingRows: { id: number }[] = []
const limit = vi.fn(async () => existingRows)
const where = vi.fn(() => ({ limit }))
const from = vi.fn(() => ({ where }))
const select = vi.fn(() => ({ from }))

// The campaigns insert appends to the backing store and returns its id.
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

// campaign_sends rows written by logSend (used at approval time via api/approve.ts).
const recordedSends: Array<{ channel: string; status: string; errorMessage?: string }> = []
const sendValues = vi.fn(async (row: { channel: string; status: string; errorMessage?: string }) => {
  recordedSends.push(row)
})

const insert = vi.fn((table: unknown) => {
  if (tableName(table) === 'campaign_sends') return { values: sendValues }
  return { values: insertValues }
})

// The draft store: runCampaign ends with db.update(...).set({copy,status}).where(...).
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
const generateCampaignCopy = vi.fn(async () => ({
  email: { subject: 'Subj', body: 'Body' },
  sms: { message: 'sms text' },
  whatsapp: { message: 'wa text' },
  viber: { message: 'viber text' },
}))

vi.mock('./ai/generator.js', () => ({
  generateCampaignCopy: () => generateCampaignCopy(),
}))

// --- collaborators mock -----------------------------------------------------
const getOptedInCustomers = vi.fn(async (): Promise<unknown[]> => [])
const getCustomerOrders = vi.fn(async (_id: number) => [])

vi.mock('./shopify/client.js', () => ({
  getOptedInCustomers: () => getOptedInCustomers(),
  getCustomerOrders: (id: number) => getCustomerOrders(id),
}))

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
    recordedSends.length = 0
  })

  it('skips the campaign when the product already has a campaign', async () => {
    existingRows = [{ id: 1 }]

    await runCampaign(product)

    expect(select).toHaveBeenCalledTimes(1)
    expect(insert).not.toHaveBeenCalled()
    expect(getOptedInCustomers).not.toHaveBeenCalled()
  })

  it('inserts a campaign row and proceeds when first-time', async () => {
    existingRows = []

    await runCampaign(product)

    expect(select).toHaveBeenCalledTimes(1)
    expect(insertValues).toHaveBeenCalledTimes(1)
    expect(insertValues).toHaveBeenCalledWith({ productId: '12345', productTitle: 'Geezer Tee' })
    expect(getOptedInCustomers).toHaveBeenCalledTimes(1)
  })

  it('re-delivering the same product creates no second record on the second run', async () => {
    existingRows = []

    await runCampaign(product)
    await runCampaign(product)

    expect(select).toHaveBeenCalledTimes(2)
    expect(insertValues).toHaveBeenCalledTimes(1)
    expect(getOptedInCustomers).toHaveBeenCalledTimes(1)
  })
})

describe('runCampaign draft behaviour', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    existingRows = []
    recordedSends.length = 0
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

    // Draft persisted via a single update setting status='draft' and the copy JSON.
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
