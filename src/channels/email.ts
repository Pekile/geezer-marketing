import { Resend } from 'resend'
import config from '../config.js'

const resend = new Resend(config.RESEND_API_KEY)

export async function sendEmail(to: string, subject: string, body: string): Promise<void> {
  if (!config.RESEND_API_KEY || config.RESEND_API_KEY === 're_...') {
    console.log(`[email:mock] to=${to} | subject=${subject}`)
    return
  }
  const { error } = await resend.emails.send({ from: config.EMAIL_FROM, to, subject, html: body })
  if (error) throw new Error(`Resend error: ${error.message}`)
}
