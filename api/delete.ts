import type { VercelRequest, VercelResponse } from '@vercel/node'
import { eq } from 'drizzle-orm'
import { db } from '../src/db/client.js'
import { campaigns, campaignSends } from '../src/db/schema.js'
import config from '../src/config.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')

  if (req.method !== 'DELETE') {
    res.status(405).send('Method not allowed')
    return
  }

  if (config.DASHBOARD_SECRET) {
    const auth = req.headers['x-secret'] as string
    if (auth !== config.DASHBOARD_SECRET) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }
  }

  const idParam = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id
  const id = Number(idParam)
  if (!idParam || !Number.isInteger(id)) {
    res.status(400).json({ error: 'Missing or invalid id' })
    return
  }

  // Delete sends first (FK constraint), then the campaign itself.
  await db.delete(campaignSends).where(eq(campaignSends.campaignId, id))
  await db.delete(campaigns).where(eq(campaigns.id, id))

  res.json({ ok: true })
}
