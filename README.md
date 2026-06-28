# Geezer Marketing Automation

Multi-channel marketing automation for Geezer Collection (geezer.rs).

## What it does

- Listens for new Shopify products → auto-generates campaigns
- Sends Email, SMS, and WhatsApp messages in Serbian
- AI-powered content using brand voice and customer context
- Per-customer personalization based on order history
- Multi-client dashboard

## Stack

- **Backend:** Node.js + TypeScript
- **Database:** PostgreSQL + pgvector
- **Email:** Resend
- **SMS:** Infobip
- **WhatsApp:** Meta Cloud API
- **AI:** Claude API (claude-sonnet-4-6)
- **Queue:** BullMQ + Redis

## Setup

See `.env.example` for required environment variables.
