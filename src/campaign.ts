import { eq } from 'drizzle-orm'
import { generateCampaignCopy } from './ai/generator.js'
import { db } from './db/client.js'
import { campaignSends, campaigns } from './db/schema.js'
import { getCustomerOrders, getOptedInCustomers } from './shopify/client.js'
import type { ShopifyProduct } from './shopify/types.js'

/**
 * One customer's generated copy, captured at draft time so the approval
 * endpoint can dispatch the exact messages the owner reviewed. Serialised as
 * JSON into `campaigns.copy`.
 */
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

export async function runCampaign(product: ShopifyProduct): Promise<void> {
  const productId = product.id.toString()

  const existing = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(eq(campaigns.productId, productId))
    .limit(1)

  if (existing.length > 0) {
    console.log(`[campaign] Skipping "${product.title}" — already campaigned`)
    return
  }

  const [campaign] = await db
    .insert(campaigns)
    .values({ productId, productTitle: product.title })
    .returning({ id: campaigns.id })

  const campaignId = campaign.id
  console.log(`[campaign] Starting for: "${product.title}" (id=${campaignId})`)

  try {
    const customers = await getOptedInCustomers()
    console.log(`[campaign] ${customers.length} customers`)

    // Generate copy for all customers in parallel (20 at a time).
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

    console.log(`[campaign] Draft saved for: "${product.title}" — ${drafts.length} customers, awaiting approval`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[campaign] FATAL error for campaign ${campaignId}:`, err)
    await db
      .update(campaigns)
      .set({ copy: JSON.stringify({ _error: msg }), status: 'error' })
      .where(eq(campaigns.id, campaignId))
  }
}
