import config from '../config.js'
import { infobipFetch, normalizePhone, testPhone } from './infobip.js'

export async function sendViber(to: string, message: string): Promise<void> {
  const recipient = testPhone() ?? normalizePhone(to)
  if (!config.INFOBIP_API_KEY || !config.INFOBIP_VIBER_SENDER) {
    console.log(`[viber:mock] to=${recipient} | ${message}`)
    return
  }
  await infobipFetch('/viber/2/messages', {
    messages: [{
      sender: config.INFOBIP_VIBER_SENDER,
      destinations: [{ to: recipient }],
      content: { text: message, type: 'TEXT' },
    }],
  })
  if (testPhone()) console.log(`[viber:test] sent to ${recipient} (real recipient: ${to})`)
}
