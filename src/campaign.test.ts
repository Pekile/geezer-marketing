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
const insertValues = vi.fn(async () => {
  existingRows.push({ id: existingRows.length + 1 })
})
const insert = vi.fn(() => ({ values: insertValues }))

vi.mock('./db/client.js', () => ({
  db: {
    select: () => select(),
    insert: () => insert(),
  },
}))

// --- collaborators mock -----------------------------------------------------
const getOptedInCustomers = vi.fn(async () => [])
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
