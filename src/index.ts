import 'dotenv/config'
import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import config from './config.js'
import { recordCampaign } from './campaign.js'
import type { ShopifyProduct } from './shopify/types.js'
import { validateWebhook } from './shopify/webhook.js'

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', chunk => chunks.push(chunk as Buffer))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  try {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200)
      res.end('ok')
      return
    }

    if (req.method === 'POST' && req.url === '/webhooks/shopify') {
      const body = await readBody(req)
      const hmac = (req.headers['x-shopify-hmac-sha256'] as string) ?? ''
      const topic = (req.headers['x-shopify-topic'] as string) ?? ''

      if (!validateWebhook(body, hmac)) {
        res.writeHead(401)
        res.end('Unauthorized')
        return
      }

      // Acknowledge immediately — Shopify requires response within 5s
      res.writeHead(200)
      res.end('ok')

      if (topic === 'products/create') {
        const product = JSON.parse(body) as ShopifyProduct
        recordCampaign(product).catch((err: unknown) => console.error('[webhook] campaign error:', err))
      }

      return
    }

    res.writeHead(404)
    res.end('Not found')
  } catch (err) {
    console.error('[server] unhandled error:', err)
    if (!res.headersSent) {
      res.writeHead(500)
      res.end('Internal server error')
    }
  }
})

server.listen(config.PORT, () => {
  console.log(`Geezer marketing server running on port ${config.PORT}`)
})
