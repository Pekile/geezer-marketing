import { waitUntil } from '@vercel/functions'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { runCampaign } from '../../src/campaign.js'
import type { ShopifyProduct } from '../../src/shopify/types.js'
import { validateWebhook } from '../../src/shopify/webhook.js'

export const maxDuration = 60

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).send('Method not allowed')
    return
  }

  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const body = Buffer.concat(chunks).toString('utf8')

  const hmac = (req.headers['x-shopify-hmac-sha256'] as string) ?? ''
  const topic = (req.headers['x-shopify-topic'] as string) ?? ''

  if (!validateWebhook(body, hmac)) {
    res.status(401).send('Unauthorized')
    return
  }

  // Acknowledge immediately — Shopify requires response within 5s
  res.status(200).send('ok')

  if (topic === 'products/create') {
    const product = JSON.parse(body) as ShopifyProduct
    waitUntil(
      runCampaign(product).catch(err => console.error('[webhook] campaign error:', err))
    )
  }
}
