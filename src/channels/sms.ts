import config from '../config.js'
import { infobipFetch } from './infobip.js'

export async function sendSms(to: string, message: string): Promise<void> {
  if (!config.INFOBIP_API_KEY) {
    console.log(`[sms:mock] to=${to} | ${message}`)
    return
  }
  await infobipFetch('/sms/2/text/advanced', {
    messages: [{ from: config.INFOBIP_SMS_SENDER, destinations: [{ to }], text: message }],
  })
}
