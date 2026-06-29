import { generateCampaignCopy } from './ai/generator.js'
import { sendEmail } from './channels/email.js'
import { sendSms } from './channels/sms.js'
import { sendViber } from './channels/viber.js'
import { sendWhatsApp } from './channels/whatsapp.js'
import { getCustomerOrders, getOptedInCustomers } from './shopify/client.js'
import type { ShopifyProduct } from './shopify/types.js'

export async function runCampaign(product: ShopifyProduct): Promise<void> {
  console.log(`[campaign] Starting for: "${product.title}"`)

  const customers = await getOptedInCustomers()
  console.log(`[campaign] ${customers.length} opted-in customers`)

  for (const customer of customers) {
    try {
      const orders = await getCustomerOrders(customer.id)
      const copy = await generateCampaignCopy(product, customer, orders)

      const sends: Promise<void>[] = []
      const emailConsented = customer.email_marketing_consent?.state === 'subscribed'
      const smsConsented = customer.sms_marketing_consent?.state === 'subscribed'

      if (emailConsented) {
        sends.push(sendEmail(customer.email, copy.email.subject, copy.email.body))
      }

      if (customer.phone && smsConsented) {
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
