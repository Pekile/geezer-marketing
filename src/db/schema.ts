import {
  integer,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'

/** Channels the live senders support, in the exact set the send loop uses. */
export const channelEnum = pgEnum('channel', ['email', 'sms', 'whatsapp', 'viber'])

/** Outcome of a single channel send attempt. */
export const sendStatusEnum = pgEnum('send_status', ['sent', 'failed'])

/**
 * One record per product campaign. `productId` is unique so a product can be
 * looked up to decide whether it has already been campaigned.
 */
export const campaigns = pgTable('campaigns', {
  id: serial('id').primaryKey(),
  productId: text('product_id').notNull().unique(),
  productTitle: text('product_title'),
  /**
   * Lifecycle of the campaign: `'draft'` once copy is generated and stored but
   * before the owner approves, `'sent'` after the approval endpoint dispatches
   * the messages. Defaults to `'draft'` so a freshly inserted campaign is never
   * treated as already sent.
   */
  status: text('status').notNull().default('draft'),
  /**
   * JSON-serialised array of per-customer generated copy (see `CustomerCopy` in
   * `src/campaign.ts`). Populated when the draft is created; nullable because a
   * campaign row can exist before its copy has been generated.
   */
  copy: text('copy'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

/**
 * One record per channel send attempt, with the channel, outcome status, an
 * optional error message, a sent-at timestamp, and a foreign key back to the
 * parent campaign.
 */
export const campaignSends = pgTable('campaign_sends', {
  id: serial('id').primaryKey(),
  campaignId: integer('campaign_id')
    .notNull()
    .references(() => campaigns.id),
  customerId: text('customer_id').notNull(),
  channel: channelEnum('channel').notNull(),
  status: sendStatusEnum('status').notNull(),
  errorMessage: text('error_message'),
  sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
})

export const campaignsRelations = relations(campaigns, ({ many }) => ({
  sends: many(campaignSends),
}))

export const campaignSendsRelations = relations(campaignSends, ({ one }) => ({
  campaign: one(campaigns, {
    fields: [campaignSends.campaignId],
    references: [campaigns.id],
  }),
}))

export type Campaign = typeof campaigns.$inferSelect
export type NewCampaign = typeof campaigns.$inferInsert
export type CampaignSend = typeof campaignSends.$inferSelect
export type NewCampaignSend = typeof campaignSends.$inferInsert

/** A channel the send loop targets, as constrained by `channelEnum`. */
export type Channel = (typeof channelEnum.enumValues)[number]
