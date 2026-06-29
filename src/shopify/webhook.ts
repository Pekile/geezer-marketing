import { createHmac } from 'node:crypto'
import config from '../config.js'

export function validateWebhook(body: string, hmacHeader: string): boolean {
  if (!config.SHOPIFY_WEBHOOK_SECRET) return true
  const computed = createHmac('sha256', config.SHOPIFY_WEBHOOK_SECRET)
    .update(body, 'utf8')
    .digest('base64')
  return computed === hmacHeader
}
