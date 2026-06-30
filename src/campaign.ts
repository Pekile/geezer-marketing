import { eq } from 'drizzle-orm'
import { generateCampaignCopy } from './ai/generator.js'
import { sendEmail } from './channels/email.js'
import { sendSms } from './channels/sms.js'
import { sendViber } from './channels/viber.js'
import { sendWhatsApp } from './channels/whatsapp.js'
import { db } from './db/client.js'
import { campaigns } from './db/schema.js'
import { getCustomerOrders, getOptedInCustomers } from './shopify/client.js'
import type { ShopifyProduct } from './shopify/types.js'

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

  await db.insert(campaigns).values({ productId, productTitle: product.title })

  console.log(`[campaign] Starting for: "${product.title}"`)

  const customers = await getOptedInCustomers()
  console.log(`[campaign] ${customers.length} opted-in customers`)

  for (const customer of customers) {
    try {
      const orders = await getCustomerOrders(customer.id)
      const copy = await generateCampaignCopy(product, customer, orders)

      const sends: Promise<void>[] = []

      if (customer.email) {
        sends.push(sendEmail(customer.email, copy.email.subject, copy.email.body))
      }

      if (customer.phone) {
        sends.push(sendSms(customer.phone, copy.sms.message))
        sends.push(sendWhatsApp(customer.phone, copy.whatsapp.message))
        sends.push(sendViber(customer.phone, copy.viber.message))
      }

      await Promise.all(sends)
      console.log(`[campaign] ✓ ${customer.email ?? customer.id}`)
    } catch (err) {
      console.error(`[campaign] ✗ customer ${customer.id}:`, err)
    }
  }

  console.log(`[campaign] Done for: "${product.title}"`)
}
