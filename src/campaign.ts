import { eq } from 'drizzle-orm'
import { generateCampaignCopyBatch } from './ai/generator.js'
import { db } from './db/client.js'
import { campaignSends, campaigns } from './db/schema.js'
import { getOptedInCustomers, getProduct } from './shopify/client.js'
import config from './config.js'
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

  // The `campaigns.productId` unique constraint is the source of truth for
  // "campaign this product once." Insert with ON CONFLICT DO NOTHING so two
  // concurrent product/create deliveries serialize at the DB: exactly one wins
  // the insert and gets a returned row; the loser gets an empty `returning()`
  // and is treated as a clean skip rather than an unhandled unique violation.
  const inserted = await db
    .insert(campaigns)
    .values({ productId, productTitle: product.title, status: 'pending' })
    .onConflictDoNothing({ target: campaigns.productId })
    .returning({ id: campaigns.id })

  if (inserted.length === 0) {
    console.log(`[campaign] Already recorded "${product.title}" (product ${productId})`)
    return null
  }

  const [campaign] = inserted
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

  const allCustomers = await getOptedInCustomers()

  // In test mode generate copy for only 5 customers — the dashboard preview shows
  // one, and approve only sends to 1 test recipient anyway.
  const isTestMode = !!(config.TEST_RECIPIENT_EMAIL || config.TEST_RECIPIENT_PHONE)
  const customers = isTestMode ? allCustomers.slice(0, 5) : allCustomers
  console.log(`[campaign] ${customers.length}${isTestMode ? ` (test mode, of ${allCustomers.length})` : ''} customers — generating copy...`)

  const CLAUDE_BATCH_SIZE = 5
  const CLAUDE_CONCURRENCY = 2
  const claudeBatches = []
  for (let i = 0; i < customers.length; i += CLAUDE_BATCH_SIZE) {
    claudeBatches.push(customers.slice(i, i + CLAUDE_BATCH_SIZE))
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
        const customer = batch[k]
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

  if (drafts.length === 0) {
    throw new Error('No copy was generated — all Claude batches failed. Check Anthropic API key and rate limits.')
  }

  await db
    .update(campaigns)
    .set({ copy: JSON.stringify(drafts), status: 'draft' })
    .where(eq(campaigns.id, campaignId))

  console.log(`[campaign] Draft saved — ${drafts.length} customers, awaiting approval`)
  return drafts.length
}
