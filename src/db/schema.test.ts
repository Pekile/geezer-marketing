import { describe, expect, it } from 'vitest'
import {
  createTableRelationsHelpers,
  getTableColumns,
  getTableName,
} from 'drizzle-orm'
import { getTableConfig } from 'drizzle-orm/pg-core'
import {
  campaignSends,
  campaignSendsRelations,
  campaigns,
  campaignsRelations,
  channelEnum,
  sendStatusEnum,
} from './schema.js'

describe('db schema', () => {
  it('defines the campaigns table', () => {
    expect(campaigns).toBeDefined()
    expect(getTableName(campaigns)).toBe('campaigns')
    const cols = getTableColumns(campaigns)
    expect(Object.keys(cols)).toEqual(
      expect.arrayContaining(['id', 'productId', 'productTitle', 'status', 'copy', 'createdAt']),
    )
    expect(cols.productId.notNull).toBe(true)
    expect(cols.productId.isUnique).toBe(true)
  })

  it('defines the approval columns on campaigns', () => {
    const cols = getTableColumns(campaigns)
    // status is required and defaults to 'draft' so a new campaign is never
    // treated as already sent.
    expect(cols.status.notNull).toBe(true)
    expect(cols.status.default).toBe('draft')
    // copy holds the serialised draft JSON and is nullable.
    expect(cols.copy.notNull).toBe(false)
  })

  it('defines the campaign_sends table', () => {
    expect(campaignSends).toBeDefined()
    expect(getTableName(campaignSends)).toBe('campaign_sends')
    const cols = getTableColumns(campaignSends)
    expect(Object.keys(cols)).toEqual(
      expect.arrayContaining([
        'id',
        'campaignId',
        'customerId',
        'channel',
        'status',
        'errorMessage',
        'sentAt',
      ]),
    )
    expect(cols.campaignId.notNull).toBe(true)
    expect(cols.channel.notNull).toBe(true)
    expect(cols.status.notNull).toBe(true)
    // error_message is nullable
    expect(cols.errorMessage.notNull).toBe(false)
  })

  it('relates campaign_sends back to campaigns via a foreign key', () => {
    const cols = getTableColumns(campaignSends)
    // The FK column carries the same SQL type as campaigns.id (serial -> integer).
    expect(cols.campaignId.columnType).toBe('PgInteger')
  })

  it('declares a foreign key from campaign_sends.campaign_id to campaigns.id', () => {
    const { foreignKeys } = getTableConfig(campaignSends)
    expect(foreignKeys).toHaveLength(1)
    const ref = foreignKeys[0].reference()
    expect(ref.columns.map((c) => c.name)).toEqual(['campaign_id'])
    expect(ref.foreignColumns.map((c) => c.name)).toEqual(['id'])
    expect(getTableName(ref.foreignTable)).toBe('campaigns')
  })

  it('exposes the campaign->sends relationship in both directions', () => {
    // campaigns has many sends; campaign_sends belongs to one campaign.
    const campaignFields = campaignsRelations.config(
      createTableRelationsHelpers(campaigns),
    )
    expect(Object.keys(campaignFields)).toContain('sends')

    const sendFields = campaignSendsRelations.config(
      createTableRelationsHelpers(campaignSends),
    )
    expect(Object.keys(sendFields)).toContain('campaign')
  })

  it('exposes the channel enum with exactly email, sms, whatsapp, viber', () => {
    expect(channelEnum.enumValues).toEqual(['email', 'sms', 'whatsapp', 'viber'])
  })

  it('exposes the status enum with exactly sent, failed', () => {
    expect(sendStatusEnum.enumValues).toEqual(['sent', 'failed'])
  })
})
