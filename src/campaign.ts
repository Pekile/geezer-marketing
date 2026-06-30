import { eq } from 'drizzle-orm'
import { generateCampaignCopy } from './ai/generator.js'
import { sendEmail } from './channels/email.js'
import { sendSms } from './channels/sms.js'
import { sendViber } from './channels/viber.js'
import { sendWhatsApp } from './channels/whatsapp.js'
import { db } from './db/client.js'
import { campaignSends, campaigns } from './db/schema.js'
import { getCustomerOrders, getOptedInCustomers } from './shopify/client.js'
import type { ShopifyProduct } from './shopify/types.js'

async function logSend(
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

  const customers = await getOptedInCustomers()
  console.log(`[campaign] ${customers.length} customers`)

  for (const customer of customers) {
    const customerId = customer.id.toString()
    try {
      const orders = await getCustomerOrders(customer.id)
      const copy = await generateCampaignCopy(product, customer, orders)

      const sends: Promise<void>[] = []

      if (customer.email) {
        sends.push(logSend(campaignId, customerId, 'email',
          () => sendEmail(customer.email, copy.email.subject, copy.email.body)))
      }

      if (customer.phone) {
        sends.push(logSend(campaignId, customerId, 'sms',
          () => sendSms(customer.phone, copy.sms.message)))
        sends.push(logSend(campaignId, customerId, 'whatsapp',
          () => sendWhatsApp(customer.phone, copy.whatsapp.message)))
        sends.push(logSend(campaignId, customerId, 'viber',
          () => sendViber(customer.phone, copy.viber.message)))
      }

      await Promise.allSettled(sends)
      console.log(`[campaign] ✓ ${customer.email ?? customerId}`)
    } catch (err) {
      console.error(`[campaign] ✗ customer ${customerId}:`, err)
    }
  }

  console.log(`[campaign] Done for: "${product.title}"`)
}
