import config from '../config.js'
import { infobipFetch, normalizePhone, testPhone } from './infobip.js'

export async function sendSms(to: string, message: string): Promise<void> {
  const recipient = testPhone() ?? normalizePhone(to)
  if (!config.INFOBIP_API_KEY) {
    console.log(`[sms:mock] to=${recipient} | ${message}`)
    return
  }
  await infobipFetch('/sms/2/text/advanced', {
    messages: [{ from: config.INFOBIP_SMS_SENDER, destinations: [{ to: recipient }], text: message }],
  })
  if (testPhone()) console.log(`[sms:test] sent to ${recipient} (real recipient: ${to})`)
}
