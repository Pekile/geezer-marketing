import Anthropic from '@anthropic-ai/sdk'
import config from '../config.js'
import type { ShopifyCustomer, ShopifyOrder, ShopifyProduct } from '../shopify/types.js'

const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY })

export interface CampaignCopy {
  email: { subject: string; body: string }
  sms: { message: string }
  whatsapp: { message: string }
  viber: { message: string }
}

export async function generateCampaignCopy(
  product: ShopifyProduct,
  customer: ShopifyCustomer,
  orders: ShopifyOrder[],
): Promise<CampaignCopy> {
  const orderHistory = orders.length
    ? orders.map(o => o.line_items.map(i => `${i.title} (${i.quantity}x)`).join(', ')).join(' | ')
    : 'nema prethodnih narudžbina'

  const price = product.variants[0]?.price ?? 'N/A'
  const description = product.body_html.replace(/<[^>]+>/g, '').trim()

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    system: `Ti si marketinški copywriter za Geezer Collection, srpski brend muške mode poznat po kvalitetu i autentičnom stilu.
Pišeš personalizovane marketinške poruke na srpskom jeziku. Ton je prijatan, direktan i moderan — nikad pretenciozno.`,
    tools: [{
      name: 'campaign_copy',
      description: 'Structured marketing campaign copy for email, SMS, and WhatsApp',
      input_schema: {
        type: 'object' as const,
        properties: {
          email: {
            type: 'object',
            properties: {
              subject: { type: 'string', description: 'Email subject line' },
              body: { type: 'string', description: 'Plain text email body, 3-5 sentences max' },
            },
            required: ['subject', 'body'],
          },
          sms: {
            type: 'object',
            properties: {
              message: { type: 'string', description: 'SMS text, max 160 characters' },
            },
            required: ['message'],
          },
          whatsapp: {
            type: 'object',
            properties: {
              message: { type: 'string', description: 'WhatsApp message with emojis, 2-3 sentences' },
            },
            required: ['message'],
          },
          viber: {
            type: 'object',
            properties: {
              message: { type: 'string', description: 'Viber message, friendly tone, 2-3 sentences, emojis OK' },
            },
            required: ['message'],
          },
        },
        required: ['email', 'sms', 'whatsapp', 'viber'],
      },
    }],
    tool_choice: { type: 'tool', name: 'campaign_copy' },
    messages: [{
      role: 'user',
      content: `Novi proizvod: ${product.title} — ${price} RSD
Opis: ${description}
Kupac: ${customer.first_name} ${customer.last_name}
Prethodne kupovine: ${orderHistory}

Napiši personalizovanu kampanju za email, SMS (max 160 karaktera), WhatsApp i Viber.`,
    }],
  })

  const toolUse = message.content.find(b => b.type === 'tool_use')
  if (!toolUse || toolUse.type !== 'tool_use') throw new Error('No tool_use block in response')
  return toolUse.input as CampaignCopy
}
