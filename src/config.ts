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
  INFOBIP_SMS_SENDER: z.string().default('Geezer'),
  INFOBIP_WHATSAPP_SENDER: z.string().default(''),
  INFOBIP_WHATSAPP_TEMPLATE: z.string().default('test_whatsapp_template_en'),
  INFOBIP_VIBER_SENDER: z.string().default(''),
  DATABASE_URL: z.string().default('postgresql://localhost:5432/geezer_marketing'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  TEST_RECIPIENT_EMAIL: z.string().default(''),
  TEST_RECIPIENT_PHONE: z.string().default(''),
  TEST_RECIPIENT_WHATSAPP: z.string().default(''),
  DASHBOARD_SECRET: z.string().default(''),
}).parse(process.env)

export default env
