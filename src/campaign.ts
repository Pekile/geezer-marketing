import { eq } from 'drizzle-orm'
import { generateCampaignCopyBatch } from './ai/generator.js'
import type { CustomerWithOrders } from './ai/generator.js'
import { db } from './db/client.js'
import { campaignSends, campaigns } from './db/schema.js'
import { getCustomerOrders, getOptedInCustomers, getProduct } from './shopify/client.js'
import type { ShopifyProduct } from './shopify/types.js'

export type CustomerCopy = {
  customerId: string
  firstName: string
  email: string | null
  phone: string | null
  email_subject: string
  email_body: string
  sms: string
  whatsapp: string
  viber: string
}

export async function logSend(
  campaignId: number,
  customerId: string,
  channel: 'email' | 'sms' | 'whatsapp' | 'viber',
  fn: () => Promise<void>,
): Promise<void> {
  try {
    await fn()
    await db.insert(campaignSends).values({ campaignId, customerId, channel, status: 'sent' })
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    await db.insert(campaignSends).values({ campaignId, customerId, channel, status: 'failed', errorMessage })
    throw err
  }
}

/**
 * Called by the webhook handler immediately on product/create.
 * Just records the campaign row so the dashboard can show it.
 * Copy generation is deferred to /api/generate (triggered by the dashboard).
 * Returns null if a campaign for this product already exists (idempotent).
 */
export async function recordCampaign(product: ShopifyProduct): Promise<number | null> {
  const productId = product.id.toString()

  const existing = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(eq(campaigns.productId, productId))
    .limit(1)

  if (existing.length > 0) {
    console.log(`[campaign] Already recorded "${product.title}" (id=${existing[0].id})`)
    return null
  }

  const [campaign] = await db
    .insert(campaigns)
    .values({ productId, productTitle: product.title, status: 'pending' })
    .returning({ id: campaigns.id })

  console.log(`[campaign] Recorded "${product.title}" (id=${campaign.id}) — pending copy generation`)
  return campaign.id
}

/**
 * Generates marketing copy for every opted-in customer and stores it in the
 * campaign row. Called from /api/generate, which is triggered by the dashboard.
 * Returns the number of customer drafts generated.
 */
export async function generateCopiesForCampaign(campaignId: number): Promise<number> {
  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1)

  if (!campaign) throw new Error(`Campaign ${campaignId} not found`)

  const product = await getProduct(campaign.productId)
  console.log(`[campaign] Generating copy for "${product.title}" (campaign ${campaignId})`)

  const customers = await getOptedInCustomers()
  console.log(`[campaign] ${customers.length} customers — fetching order history...`)

  // Step 1: fetch all customer orders concurrently (20 at a time, Shopify is fast).
  const SHOPIFY_CONCURRENCY = 20
  const customersWithOrders: CustomerWithOrders[] = []
  for (let i = 0; i < customers.length; i += SHOPIFY_CONCURRENCY) {
    const slice = customers.slice(i, i + SHOPIFY_CONCURRENCY)
    const results = await Promise.all(
      slice.map(async customer => ({
        customer,
        orders: await getCustomerOrders(customer.id),
      })),
    )
    customersWithOrders.push(...results)
  }

  // Step 2: generate copy for 8 customers per Claude call, 5 calls at a time.
  // This turns 156 Claude calls into ~20 calls, reducing runtime from 2+ min to ~30s.
  const CLAUDE_BATCH_SIZE = 8
  const CLAUDE_CONCURRENCY = 5
  const claudeBatches: CustomerWithOrders[][] = []
  for (let i = 0; i < customersWithOrders.length; i += CLAUDE_BATCH_SIZE) {
    claudeBatches.push(customersWithOrders.slice(i, i + CLAUDE_BATCH_SIZE))
  }
  console.log(`[campaign] ${claudeBatches.length} Claude batches of up to ${CLAUDE_BATCH_SIZE} customers`)

  const drafts: CustomerCopy[] = []
  for (let i = 0; i < claudeBatches.length; i += CLAUDE_CONCURRENCY) {
    const wave = claudeBatches.slice(i, i + CLAUDE_CONCURRENCY)
    const waveResults = await Promise.allSettled(
      wave.map(batch => generateCampaignCopyBatch(product, batch)),
    )
    for (let j = 0; j < waveResults.length; j++) {
      const r = waveResults[j]
      const batch = wave[j]
      if (r.status === 'rejected') {
        console.error('[campaign] ✗ batch failed:', r.reason)
        continue
      }
      for (let k = 0; k < batch.length; k++) {
        const { customer } = batch[k]
        const copy = r.value[k]
        if (!copy) {
          console.error(`[campaign] ✗ missing copy for customer ${customer.id}`)
          continue
        }
        drafts.push({
          customerId: customer.id.toString(),
          firstName: customer.first_name,
          email: customer.email ?? null,
          phone: customer.phone ?? null,
          email_subject: copy.email.subject,
          email_body: copy.email.body,
          sms: copy.sms.message,
          whatsapp: copy.whatsapp.message,
          viber: copy.viber.message,
        })
      }
    }
    console.log(`[campaign] wave ${Math.floor(i / CLAUDE_CONCURRENCY) + 1}/${Math.ceil(claudeBatches.length / CLAUDE_CONCURRENCY)} done — ${drafts.length} copies so far`)
  }

  await db
    .update(campaigns)
    .set({ copy: JSON.stringify(drafts), status: 'draft' })
    .where(eq(campaigns.id, campaignId))

  console.log(`[campaign] Draft saved — ${drafts.length} customers, awaiting approval`)
  return drafts.length
}
