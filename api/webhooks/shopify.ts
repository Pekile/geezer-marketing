import type { VercelRequest, VercelResponse } from '@vercel/node'
import { recordCampaign } from '../../src/campaign.js'
import type { ShopifyProduct } from '../../src/shopify/types.js'
import { validateWebhook } from '../../src/shopify/webhook.js'

export const maxDuration = 30

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

  if (topic === 'products/create') {
    const product = JSON.parse(body) as ShopifyProduct
    // Just record the campaign row — copy is generated later via /api/generate
    // when the dashboard loads, so we never risk Vercel background-task timeouts.
    await recordCampaign(product)
  }

  res.status(200).send('ok')
}
