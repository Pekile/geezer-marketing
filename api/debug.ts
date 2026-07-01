import type { VercelRequest, VercelResponse } from '@vercel/node'
import config from '../src/config.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')

  if (config.DASHBOARD_SECRET) {
    const auth = req.headers['x-secret'] as string
    if (auth !== config.DASHBOARD_SECRET) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }
  }

  const steps: Record<string, unknown> = {}

  // 1. Check env vars
  steps.env = {
    SHOPIFY_STORE_DOMAIN: config.SHOPIFY_STORE_DOMAIN || '(missing)',
    SHOPIFY_CLIENT_ID: config.SHOPIFY_CLIENT_ID ? `${config.SHOPIFY_CLIENT_ID.slice(0, 8)}…` : '(missing)',
    SHOPIFY_CLIENT_SECRET: config.SHOPIFY_CLIENT_SECRET ? '(set)' : '(missing)',
    SHOPIFY_ADMIN_API_TOKEN: config.SHOPIFY_ADMIN_API_TOKEN ? '(set)' : '(missing)',
    ANTHROPIC_API_KEY: config.ANTHROPIC_API_KEY ? '(set)' : '(missing)',
    DATABASE_URL: config.DATABASE_URL ? '(set)' : '(missing)',
  }

  // 2. Test Shopify token
  try {
    const tokenRes = await fetch(
      `https://${config.SHOPIFY_STORE_DOMAIN}/admin/oauth/access_token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: config.SHOPIFY_CLIENT_ID,
          client_secret: config.SHOPIFY_CLIENT_SECRET,
        }),
      },
    )
    const tokenText = await tokenRes.text()
    steps.shopify_token = {
      status: tokenRes.status,
      ok: tokenRes.ok,
      body: tokenText.slice(0, 200),
    }

    // 3. If token ok, test customer fetch
    if (tokenRes.ok) {
      const tokenData = JSON.parse(tokenText) as { access_token: string }
      const custRes = await fetch(
        `https://${config.SHOPIFY_STORE_DOMAIN}/admin/api/2024-01/customers.json?limit=5&fields=id,email,first_name`,
        { headers: { 'X-Shopify-Access-Token': tokenData.access_token } },
      )
      const custText = await custRes.text()
      steps.shopify_customers = {
        status: custRes.status,
        ok: custRes.ok,
        body: custText.slice(0, 500),
      }
    }
  } catch (err) {
    steps.shopify_error = err instanceof Error ? err.message : String(err)
  }

  // 4. Test DB
  try {
    const { db } = await import('../src/db/client.js')
    const { campaigns } = await import('../src/db/schema.js')
    const rows = await db.select().from(campaigns).limit(3)
    steps.db = { ok: true, campaign_count: rows.length }
  } catch (err) {
    steps.db = { ok: false, error: err instanceof Error ? err.message : String(err) }
  }

  res.json({ ok: true, steps })
}
