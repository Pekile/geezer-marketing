import { describe, expect, it } from 'vitest'
import { getTableColumns, getTableName } from 'drizzle-orm'
import {
  campaignSends,
  campaigns,
  channelEnum,
  sendStatusEnum,
} from './schema.js'

describe('db schema', () => {
  it('defines the campaigns table', () => {
    expect(campaigns).toBeDefined()
    expect(getTableName(campaigns)).toBe('campaigns')
    const cols = getTableColumns(campaigns)
    expect(Object.keys(cols)).toEqual(
      expect.arrayContaining(['id', 'productId', 'productTitle', 'createdAt']),
    )
    expect(cols.productId.notNull).toBe(true)
    expect(cols.productId.isUnique).toBe(true)
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

  it('exposes the channel enum with exactly email, sms, whatsapp, viber', () => {
    expect(channelEnum.enumValues).toEqual(['email', 'sms', 'whatsapp', 'viber'])
  })

  it('exposes the status enum with exactly sent, failed', () => {
    expect(sendStatusEnum.enumValues).toEqual(['sent', 'failed'])
  })
})
