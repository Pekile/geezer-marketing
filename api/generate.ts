import type { VercelRequest, VercelResponse } from '@vercel/node'
import { generateCopiesForCampaign } from '../src/campaign.js'
import config from '../src/config.js'

export const maxDuration = 300

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')

  if (req.method !== 'POST') {
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

  try {
    const generated = await generateCopiesForCampaign(id)
    res.json({ ok: true, generated })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[generate] error:', err)
    res.status(500).json({ ok: false, error: msg })
  }
}
