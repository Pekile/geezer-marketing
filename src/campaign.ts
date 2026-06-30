import { eq } from 'drizzle-orm'
import { generateCampaignCopy } from './ai/generator.js'
import { sendEmail } from './channels/email.js'
import { sendSms } from './channels/sms.js'
import { sendViber } from './channels/viber.js'
import { sendWhatsApp } from './channels/whatsapp.js'
import { db } from './db/client.js'
import { campaigns, campaignSends } from './db/schema.js'
import type { Channel } from './db/schema.js'
import { getCustomerOrders, getOptedInCustomers } from './shopify/client.js'
import type { ShopifyCustomer, ShopifyProduct } from './shopify/types.js'

/**
 * A single channel send for one customer: the channel it targets and a thunk
 * that performs the send. The senders fail by throwing and return no value, so
 * each attempt is wrapped here and run on its own (see {@link attemptSends}) —
 * one persisted `campaign_sends` row is written per attempt regardless of
 * outcome, and one channel throwing never blocks the siblings.
 */
interface PlannedSend {
  channel: Channel
  send: () => Promise<void>
}

export async function runCampaign(product: ShopifyProduct): Promise<void> {
  const productId = product.id.toString()

  // Idempotency guard: a product that already has a campaign is never
  // campaigned again. The first run records the product; later runs are skipped.
  const existing = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(eq(campaigns.productId, productId))
    .limit(1)

  if (existing.length > 0) {
    console.log(
      `[campaign] Skipping "${product.title}" — product ${productId} already has a campaign`,
    )
    return
  }

  const [campaign] = await db
    .insert(campaigns)
    .values({ productId, productTitle: product.title })
    .returning({ id: campaigns.id })

  console.log(`[campaign] Starting for: "${product.title}"`)

  const customers = await getOptedInCustomers()
  console.log(`[campaign] ${customers.length} opted-in customers`)

  for (const customer of customers) {
    try {
      const orders = await getCustomerOrders(customer.id)
      const copy = await generateCampaignCopy(product, customer, orders)

      const planned: PlannedSend[] = []
      const emailConsented = customer.email_marketing_consent?.state === 'subscribed'
      const smsConsented = customer.sms_marketing_consent?.state === 'subscribed'

      if (emailConsented) {
        planned.push({
          channel: 'email',
          send: () => sendEmail(customer.email, copy.email.subject, copy.email.body),
        })
      }

      if (customer.phone && smsConsented) {
        planned.push({
          channel: 'sms',
          send: () => sendSms(customer.phone as string, copy.sms.message),
        })
        planned.push({
          channel: 'whatsapp',
          send: () => sendWhatsApp(customer.phone as string, customer.first_name),
        })
        planned.push({
          channel: 'viber',
          send: () => sendViber(customer.phone as string, copy.viber.message),
        })
      }

      await attemptSends(campaign.id, customer, planned)
      console.log(`[campaign] ✓ ${customer.email ?? customer.id}`)
    } catch (err) {
      console.error(`[campaign] ✗ customer ${customer.id}:`, err)
    }
  }

  console.log(`[campaign] Done for: "${product.title}"`)
}

/**
 * Attempt every planned send for one customer individually and persist exactly
 * one `campaign_sends` row per attempt. A send that resolves records a `sent`
 * row; a send that throws records a `failed` row carrying the error message.
 * Each attempt is isolated, so one channel failing never prevents the remaining
 * channels for the customer from being attempted and logged.
 */
async function attemptSends(
  campaignId: number,
  customer: ShopifyCustomer,
  planned: PlannedSend[],
): Promise<void> {
  const customerId = customer.id.toString()

  for (const { channel, send } of planned) {
    try {
      await send()
      await db.insert(campaignSends).values({
        campaignId,
        customerId,
        channel,
        status: 'sent',
      })
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      console.error(`[campaign] ✗ ${channel} for customer ${customer.id}:`, err)
      await db.insert(campaignSends).values({
        campaignId,
        customerId,
        channel,
        status: 'failed',
        errorMessage,
      })
    }
  }
}
