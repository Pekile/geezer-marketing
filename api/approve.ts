import type { VercelRequest, VercelResponse } from '@vercel/node'
import { eq } from 'drizzle-orm'
import { channelsFor, logSend } from '../src/campaign.js'
import type { CustomerCopy } from '../src/campaign.js'
import { db } from '../src/db/client.js'
import { campaigns } from '../src/db/schema.js'
import config from '../src/config.js'

/**
 * POST /api/approve?id=<campaignId>
 *
 * Approves a draft campaign: parses the copy that was stored when the draft was
 * created, dispatches it across every channel via the shared `logSend` helper
 * (so `campaign_sends` rows are written exactly as a direct send would), and
 * flips the campaign to `'sent'`. Returns `{ ok: true, sent: N }` where N is the
 * number of customers the campaign was dispatched to.
 */
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

  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.id, id))
    .limit(1)

  if (!campaign) {
    res.status(404).json({ error: 'Campaign not found' })
    return
  }

  if (campaign.status === 'sent') {
    res.status(400).json({ error: 'Campaign already sent' })
    return
  }

  let drafts: CustomerCopy[]
  try {
    drafts = campaign.copy ? (JSON.parse(campaign.copy) as CustomerCopy[]) : []
  } catch {
    res.status(400).json({ error: 'Stored campaign copy is not valid JSON' })
    return
  }

  // In test mode (TEST_RECIPIENT_* set), send to only one customer so the
  // test inbox gets a single sample message, not hundreds of redirected copies.
  const isTestMode = !!(config.TEST_RECIPIENT_EMAIL || config.TEST_RECIPIENT_PHONE)
  const toSend = isTestMode ? drafts.slice(0, 1) : drafts

  for (const draft of toSend) {
    // The channel fan-out rule lives once in `channelsFor` (src/campaign.ts);
    // dispatch is driven from it so this path can't drift from the rule.
    const sends = channelsFor(draft).map(({ channel, fn }) =>
      logSend(campaign.id, draft.customerId, channel, fn),
    )

    await Promise.allSettled(sends)
  }

  await db
    .update(campaigns)
    .set({ status: 'sent' })
    .where(eq(campaigns.id, campaign.id))

  res.json({ ok: true, sent: toSend.length, testMode: isTestMode })
}
