import 'dotenv/config'
import { z } from 'zod'

const env = z.object({
  SHOPIFY_STORE_DOMAIN: z.string().min(1),
  SHOPIFY_ADMIN_API_TOKEN: z.string().min(1),
  SHOPIFY_WEBHOOK_SECRET: z.string().default(''),
  ANTHROPIC_API_KEY: z.string().default(''),
  RESEND_API_KEY: z.string().default(''),
  EMAIL_FROM: z.string().default('marketing@geezer.rs'),
  INFOBIP_API_KEY: z.string().default(''),
  INFOBIP_BASE_URL: z.string().default(''),
  INFOBIP_SENDER_NAME: z.string().default('Geezer'),
  WHATSAPP_PHONE_NUMBER_ID: z.string().default(''),
  WHATSAPP_ACCESS_TOKEN: z.string().default(''),
  DATABASE_URL: z.string().default('postgresql://localhost:5432/geezer_marketing'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
}).parse(process.env)

export default env
