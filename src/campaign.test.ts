import { beforeEach, describe, expect, it, vi } from 'vitest'

// --- db client mock ---------------------------------------------------------
let existingRows: { id: number }[] = []
let campaignRows: Array<{ id: number; productId: string; status: string; copy: string | null }> = []
// When true, an ON CONFLICT DO NOTHING insert hits the unique constraint and
// returns no rows (the product was already campaigned).
let insertConflicts = false

const limit = vi.fn(async () => existingRows)
const where = vi.fn((_predicate: unknown) => ({ limit }))
const from = vi.fn(() => ({ where }))
const select = vi.fn(() => ({ from }))

// Mirrors ON CONFLICT DO NOTHING ... RETURNING against the productId unique
// constraint: an insert of a productId already present returns no rows (the
// conflict path), a first-time insert returns the new row.
const insertReturning = vi.fn(async () => {
  if (insertConflicts) return []
  const id = existingRows.length + 1
  existingRows.push({ id })
  return [{ id }]
})
const insertOnConflict = vi.fn((_target: unknown) => ({ returning: insertReturning }))
const insertValues = vi.fn((_vals: unknown) => ({
  onConflictDoNothing: insertOnConflict,
  returning: insertReturning,
}))

function tableName(table: unknown): string {
  const sym = Object.getOwnPropertySymbols(table as object).find(
    s => s.description === 'drizzle:Name',
  )
  return sym ? String((table as Record<symbol, unknown>)[sym]) : String(table)
}

/**
 * Asserts that a drizzle `eq(column, value)` predicate (as passed to the mocked
 * `where`) actually filters on `column` with the given `value`. A drizzle `eq`
 * builds an SQL expression whose `queryChunks` hold the column object itself and
 * a `Param` chunk carrying the bound value — so pinning both catches a regression
 * that queried the wrong column (e.g. `campaigns.id` instead of `campaigns.productId`).
 */
function expectPredicate(predicate: unknown, column: unknown, value: unknown): void {
  const chunks = (predicate as { queryChunks?: unknown[] })?.queryChunks
  expect(Array.isArray(chunks), 'where() was not called with a drizzle eq() predicate').toBe(true)
  // The exact column object appears among the chunks (identity match).
  expect(chunks).toContain(column)
  // A Param chunk carries the bound value.
  const boundValues = (chunks as Array<Record<string, unknown>>)
    .filter(c => c && typeof c === 'object' && 'value' in c && !('name' in c))
    .map(c => c.value)
  expect(boundValues).toContain(value)
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
import { campaigns } from './db/schema.js'
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
    insertConflicts = false
  })

  it('skips (returns null) when the insert conflicts on the productId unique constraint', async () => {
    // The row already exists: ON CONFLICT DO NOTHING returns no rows.
    insertConflicts = true

    const id = await recordCampaign(product)

    expect(id).toBeNull()
  })

  it('inserts a pending campaign row when first-time', async () => {
    const id = await recordCampaign(product)

    expect(id).not.toBeNull()
    expect(insertValues).toHaveBeenCalledTimes(1)
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending' }),
    )
  })

  it('lets the DB serialize the guard — always inserts with ON CONFLICT DO NOTHING, never a check-then-insert', async () => {
    await recordCampaign(product)

    // The insert is unconditional; the unique constraint is the source of truth.
    expect(insertValues).toHaveBeenCalledTimes(1)
    expect(insertOnConflict).toHaveBeenCalledTimes(1)
    // Pin the conflict target to campaigns.productId — not campaigns.id or any other column.
    expect(insertOnConflict).toHaveBeenCalledWith(
      expect.objectContaining({ target: campaigns.productId }),
    )
  })

  it('is idempotent — a concurrent second delivery of the same product returns null', async () => {
    // First delivery wins the insert.
    const first = await recordCampaign(product)
    expect(first).not.toBeNull()

    // Second delivery hits the unique constraint and is absorbed as a skip
    // rather than throwing an uncaught unique violation.
    insertConflicts = true
    const second = await recordCampaign(product)
    expect(second).toBeNull()

    expect(insertValues).toHaveBeenCalledTimes(2)
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
