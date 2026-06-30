import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CampaignSend } from './db/schema.js'

// --- db client mock ---------------------------------------------------------
// `existingRows` controls what the campaigns lookup returns: an empty array
// means the product has no campaign yet; a non-empty array means it already
// does and the run must be skipped.
let existingRows: { id: number }[] = []
const limit = vi.fn(async () => existingRows)
const where = vi.fn(() => ({ limit }))
const from = vi.fn(() => ({ where }))
const select = vi.fn(() => ({ from }))

// The campaigns insert appends a row to the same backing store the lookup
// reads (modelling the unique `product_id` row) and returns its id, mirroring
// the `.returning({ id })` the real code uses to link sends to their campaign.
const campaignValues = vi.fn((_row: { productId: string; productTitle?: string }) => ({
  returning: async () => {
    const id = existingRows.length + 1
    existingRows.push({ id })
    return [{ id }]
  },
}))

// Every channel send attempt is persisted as one `campaign_sends` row; the test
// store collects them so the assertions can inspect channel/status/error.
const recordedSends: Partial<CampaignSend>[] = []
const sendValues = vi.fn(async (row: Partial<CampaignSend>) => {
  recordedSends.push(row)
})

// Route insert() by the table it targets: the `campaigns` table exposes
// `.returning()`, `campaign_sends` resolves a recorded row.
const insert = vi.fn((table: unknown) => {
  const name = tableName(table)
  if (name === 'campaign_sends') return { values: sendValues }
  return { values: campaignValues }
})

function tableName(table: unknown): string {
  // Drizzle tables carry their SQL name on a well-known symbol; fall back to a
  // best-effort string so the mock never throws on an unexpected shape.
  const sym = Object.getOwnPropertySymbols(table as object).find(
    s => s.description === 'drizzle:Name',
  )
  return sym ? String((table as Record<symbol, unknown>)[sym]) : String(table)
}

vi.mock('./db/client.js', () => ({
  db: {
    select: () => select(),
    insert: (table: unknown) => insert(table),
  },
}))

// --- channel sender mocks ---------------------------------------------------
const sendEmail = vi.fn(async (..._a: unknown[]) => {})
const sendSms = vi.fn(async (..._a: unknown[]) => {})
const sendWhatsApp = vi.fn(async (..._a: unknown[]) => {})
const sendViber = vi.fn(async (..._a: unknown[]) => {})

vi.mock('./channels/email.js', () => ({ sendEmail: (...a: unknown[]) => sendEmail(...a) }))
vi.mock('./channels/sms.js', () => ({ sendSms: (...a: unknown[]) => sendSms(...a) }))
vi.mock('./channels/whatsapp.js', () => ({ sendWhatsApp: (...a: unknown[]) => sendWhatsApp(...a) }))
vi.mock('./channels/viber.js', () => ({ sendViber: (...a: unknown[]) => sendViber(...a) }))

// --- copy generator mock ----------------------------------------------------
const generateCampaignCopy = vi.fn(async (..._a: unknown[]) => ({
  email: { subject: 'Sub', body: 'Body' },
  sms: { message: 'sms' },
  whatsapp: { message: 'wa' },
  viber: { message: 'viber' },
}))
vi.mock('./ai/generator.js', () => ({
  generateCampaignCopy: (...a: unknown[]) => generateCampaignCopy(...a),
}))

// --- collaborators mock -----------------------------------------------------
let customers: unknown[] = []
const getOptedInCustomers = vi.fn(async () => customers)
const getCustomerOrders = vi.fn(async (_id: number) => [])

vi.mock('./shopify/client.js', () => ({
  getOptedInCustomers: () => getOptedInCustomers(),
  getCustomerOrders: (id: number) => getCustomerOrders(id),
}))

import { runCampaign } from './campaign.js'
import type { ShopifyCustomer, ShopifyProduct } from './shopify/types.js'

const product: ShopifyProduct = {
  id: 12345,
  title: 'Geezer Tee',
  body_html: '<p>nice</p>',
  handle: 'geezer-tee',
  images: [],
  variants: [{ price: '20.00' }],
}

/** A customer opted in across all channels (email + phone with sms consent). */
function fullChannelCustomer(): ShopifyCustomer {
  return {
    id: 999,
    first_name: 'Marko',
    last_name: 'Markovic',
    email: 'marko@example.com',
    phone: '+381601234567',
    email_marketing_consent: { state: 'subscribed' },
    sms_marketing_consent: { state: 'subscribed' },
  }
}

describe('runCampaign idempotency', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    existingRows = []
    recordedSends.length = 0
    customers = []
  })

  it('skips the campaign and sends nothing when the product already has a campaign', async () => {
    existingRows = [{ id: 1 }]

    await runCampaign(product)

    expect(select).toHaveBeenCalledTimes(1)
    expect(insert).not.toHaveBeenCalled()
    expect(getOptedInCustomers).not.toHaveBeenCalled()
  })

  it('inserts a campaign row and proceeds when the product is first-time', async () => {
    existingRows = []

    await runCampaign(product)

    expect(select).toHaveBeenCalledTimes(1)
    expect(campaignValues).toHaveBeenCalledTimes(1)
    expect(campaignValues).toHaveBeenCalledWith({
      productId: '12345',
      productTitle: 'Geezer Tee',
    })
    expect(getOptedInCustomers).toHaveBeenCalledTimes(1)
  })

  it('re-delivering the same product creates no second record and sends nothing on the second run', async () => {
    existingRows = []

    await runCampaign(product)
    await runCampaign(product)

    expect(select).toHaveBeenCalledTimes(2)
    expect(campaignValues).toHaveBeenCalledTimes(1)
    expect(existingRows).toHaveLength(1)
    expect(getOptedInCustomers).toHaveBeenCalledTimes(1)
  })
})

describe('runCampaign per-channel send logging', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    existingRows = []
    recordedSends.length = 0
    customers = []
  })

  it('records one sent row per successful channel, linked to the campaign', async () => {
    customers = [fullChannelCustomer()]

    await runCampaign(product)

    // email + sms + whatsapp + viber, all resolving.
    expect(recordedSends).toHaveLength(4)
    for (const row of recordedSends) {
      expect(row.status).toBe('sent')
      expect(row.errorMessage).toBeUndefined()
      expect(row.campaignId).toBe(1)
      expect(row.customerId).toBe('999')
    }
    expect(recordedSends.map(r => r.channel).sort()).toEqual([
      'email',
      'sms',
      'viber',
      'whatsapp',
    ])
  })

  it('records a failed row carrying the error message when a channel throws', async () => {
    customers = [fullChannelCustomer()]
    sendEmail.mockRejectedValueOnce(new Error('Resend error: bad recipient'))

    await runCampaign(product)

    const email = recordedSends.find(r => r.channel === 'email')
    expect(email).toBeDefined()
    expect(email?.status).toBe('failed')
    expect(email?.errorMessage).toBe('Resend error: bad recipient')
  })

  it('still attempts and logs sibling channels when one channel fails', async () => {
    customers = [fullChannelCustomer()]
    sendSms.mockRejectedValueOnce(new Error('Infobip 500'))

    await runCampaign(product)

    // All four channels attempted despite the sms failure.
    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect(sendSms).toHaveBeenCalledTimes(1)
    expect(sendWhatsApp).toHaveBeenCalledTimes(1)
    expect(sendViber).toHaveBeenCalledTimes(1)

    // One failed row for sms; the rest are sent.
    expect(recordedSends).toHaveLength(4)
    const byChannel = Object.fromEntries(recordedSends.map(r => [r.channel, r]))
    expect(byChannel.sms.status).toBe('failed')
    expect(byChannel.sms.errorMessage).toBe('Infobip 500')
    expect(byChannel.email.status).toBe('sent')
    expect(byChannel.whatsapp.status).toBe('sent')
    expect(byChannel.viber.status).toBe('sent')
  })
})
