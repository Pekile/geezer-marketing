import type { VercelRequest, VercelResponse } from '@vercel/node'
import { eq } from 'drizzle-orm'
import { logSend } from '../src/campaign.js'
import type { CustomerCopy } from '../src/campaign.js'
import { sendEmail } from '../src/channels/email.js'
import { sendSms } from '../src/channels/sms.js'
import { sendViber } from '../src/channels/viber.js'
import { sendWhatsApp } from '../src/channels/whatsapp.js'
import { db } from '../src/db/client.js'
import { campaigns } from '../src/db/schema.js'
import config from '../src/config.js'

/**
 * POST /api/approve?id=<campaignId>
 *
 * Approves a draft campaign: parses the copy that was stored when the draft was
 * created, dispatches it across every channel via the shared `logSend` helper
 * (so `campaign_sends` rows are written exactly as a direct send would), and
 * flips the campaign to `'sent'`. Returns `{ ok: true, dispatched: N }` where N is the
 * number of customers dispatched to — not the count of individual channel messages
 * successfully delivered (per-channel outcomes live in `campaign_sends`).
 *
 * If every channel send throws (a fully-failed dispatch), the campaign is left in
 * `'send_failed'` instead of `'sent'` so it can be re-approved without a manual DB
 * edit; the response then carries `ok: false`. `'send_failed'` is deliberately
 * distinct from the `'error'` status `api/generate.ts` sets for a copy-generation
 * failure, so the dashboard can tell a failed *send* apart from a failed *generation*
 * and offer a retry rather than a "copy generation error" message. A partially-failed
 * dispatch (at least one send succeeded) is still treated as `'sent'`, matching the
 * existing contract.
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

  // Track dispatch outcomes across every channel of every customer so a
  // fully-failed dispatch is distinguishable from a successful (or partial) one.
  let attempted = 0
  let succeeded = 0

  for (const draft of toSend) {
    const sends: Promise<void>[] = []

    if (draft.email) {
      sends.push(logSend(campaign.id, draft.customerId, 'email',
        () => sendEmail(draft.email as string, draft.email_subject, draft.email_body)))
    }

    if (draft.phone) {
      const phone = draft.phone
      sends.push(logSend(campaign.id, draft.customerId, 'sms',
        () => sendSms(phone, draft.sms)))
      sends.push(logSend(campaign.id, draft.customerId, 'whatsapp',
        () => sendWhatsApp(phone, draft.whatsapp)))
      sends.push(logSend(campaign.id, draft.customerId, 'viber',
        () => sendViber(phone, draft.viber)))
    }

    const results = await Promise.allSettled(sends)
    attempted += results.length
    succeeded += results.filter(r => r.status === 'fulfilled').length
  }

  // A fully-failed dispatch (sends were attempted and every one threw) must not
  // masquerade as 'sent' — that would trip the already-sent guard above and make
  // the campaign un-retryable without a manual DB edit. Leave it in 'send_failed'
  // (distinct from generate.ts's 'error', which the dashboard reads as a copy
  // generation failure). When no sends were attempted at all, nothing failed, so
  // 'sent' still holds.
  const fullyFailed = attempted > 0 && succeeded === 0

  await db
    .update(campaigns)
    .set({ status: fullyFailed ? 'send_failed' : 'sent' })
    .where(eq(campaigns.id, campaign.id))

  res.json({ ok: !fullyFailed, dispatched: toSend.length, testMode: isTestMode })
}
