import { eq } from 'drizzle-orm'
import { generateCampaignCopy } from './ai/generator.js'
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
  console.log(`[campaign] ${customers.length} customers to process`)

  const CONCURRENCY = 20
  const drafts: CustomerCopy[] = []

  for (let i = 0; i < customers.length; i += CONCURRENCY) {
    const batch = customers.slice(i, i + CONCURRENCY)
    const results = await Promise.allSettled(
      batch.map(async customer => {
        const customerId = customer.id.toString()
        const orders = await getCustomerOrders(customer.id)
        const copy = await generateCampaignCopy(product, customer, orders)
        console.log(`[campaign] ✓ copy ready for ${customer.email ?? customerId}`)
        return {
          customerId,
          firstName: customer.first_name,
          email: customer.email ?? null,
          phone: customer.phone ?? null,
          email_subject: copy.email.subject,
          email_body: copy.email.body,
          sms: copy.sms.message,
          whatsapp: copy.whatsapp.message,
          viber: copy.viber.message,
        } satisfies CustomerCopy
      }),
    )
    for (const r of results) {
      if (r.status === 'fulfilled') drafts.push(r.value)
      else console.error('[campaign] ✗ copy failed:', r.reason)
    }
  }

  await db
    .update(campaigns)
    .set({ copy: JSON.stringify(drafts), status: 'draft' })
    .where(eq(campaigns.id, campaignId))

  console.log(`[campaign] Draft saved — ${drafts.length} customers, awaiting approval`)
  return drafts.length
}
