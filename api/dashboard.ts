import type { VercelRequest, VercelResponse } from '@vercel/node'
import { count, desc } from 'drizzle-orm'
import { db } from '../src/db/client.js'
import { campaigns, campaignSends } from '../src/db/schema.js'
import config from '../src/config.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')

  if (req.method !== 'GET') {
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

  const campaignList = await db
    .select()
    .from(campaigns)
    .orderBy(desc(campaigns.createdAt))
    .limit(50)

  const sendStats = await db
    .select({
      campaignId: campaignSends.campaignId,
      channel: campaignSends.channel,
      status: campaignSends.status,
      count: count(),
    })
    .from(campaignSends)
    .groupBy(campaignSends.campaignId, campaignSends.channel, campaignSends.status)

  const enriched = campaignList.map(c => {
    const stats = sendStats.filter(s => s.campaignId === c.id)
    const byChannel: Record<string, { sent: number; failed: number }> = {}

    for (const s of stats) {
      if (!byChannel[s.channel]) byChannel[s.channel] = { sent: 0, failed: 0 }
      if (s.status === 'sent') byChannel[s.channel].sent += Number(s.count)
      else byChannel[s.channel].failed += Number(s.count)
    }

    const totalSent = stats.filter(s => s.status === 'sent').reduce((a, s) => a + Number(s.count), 0)
    const totalFailed = stats.filter(s => s.status === 'failed').reduce((a, s) => a + Number(s.count), 0)

    return { ...c, totalSent, totalFailed, totalSends: totalSent + totalFailed, byChannel }
  })

  const totalSends = enriched.reduce((a, c) => a + c.totalSends, 0)
  const totalSent = enriched.reduce((a, c) => a + c.totalSent, 0)

  res.json({
    stats: {
      totalCampaigns: enriched.length,
      totalSends,
      totalSent,
      successRate: totalSends > 0 ? Math.round((totalSent / totalSends) * 100) : 0,
    },
    campaigns: enriched,
  })
}
