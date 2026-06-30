import { Resend } from 'resend'
import config from '../config.js'
import { testEmail } from './infobip.js'

const resend = new Resend(config.RESEND_API_KEY)

export async function sendEmail(to: string, subject: string, body: string): Promise<void> {
  const recipient = testEmail() ?? to
  if (!config.RESEND_API_KEY || config.RESEND_API_KEY === 're_...') {
    console.log(`[email:mock] to=${recipient} | subject=${subject}`)
    return
  }
  const { error } = await resend.emails.send({ from: config.EMAIL_FROM, to: recipient, subject, html: body })
  if (error) throw new Error(`Resend error: ${error.message}`)
  if (testEmail()) console.log(`[email:test] sent to ${recipient} (real recipient: ${to})`)
}
