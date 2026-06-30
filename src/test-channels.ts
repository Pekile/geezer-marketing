import 'dotenv/config'
import { sendEmail } from './channels/email.js'
import { sendSms } from './channels/sms.js'
import { sendViber } from './channels/viber.js'
import { sendWhatsApp } from './channels/whatsapp.js'
import config from './config.js'

const email = config.TEST_RECIPIENT_EMAIL
const phone = config.TEST_RECIPIENT_PHONE

if (!email || !phone) {
  console.error('Set TEST_RECIPIENT_EMAIL and TEST_RECIPIENT_PHONE in .env')
  process.exit(1)
}

console.log(`Sending test messages to: ${email} / ${phone}\n`)

const channels = [
  { name: 'Email',    fn: () => sendEmail(email, 'Geezer test — kanal radi ✓', '<p>Ovo je test poruka sa Geezer marketing sistema. Sve radi kako treba! 🎉</p>') },
  { name: 'SMS',      fn: () => sendSms(phone, 'Geezer test: SMS kanal radi ✓') },
  { name: 'WhatsApp', fn: () => sendWhatsApp(phone, 'Petar') },
  { name: 'Viber',    fn: () => sendViber(phone, 'Geezer test: Viber kanal radi ✓ 🎉') },
]

for (const { name, fn } of channels) {
  try {
    await fn()
    console.log(`✓ ${name}`)
  } catch (err) {
    console.error(`✗ ${name}:`, err instanceof Error ? err.message : err)
  }
}
