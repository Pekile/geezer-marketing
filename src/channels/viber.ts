import config from '../config.js'
import { infobipFetch } from './infobip.js'

export async function sendViber(to: string, message: string): Promise<void> {
  if (!config.INFOBIP_API_KEY || !config.INFOBIP_VIBER_SENDER) {
    console.log(`[viber:mock] to=${to} | ${message}`)
    return
  }
  await infobipFetch('/viber/2/message/text', {
    messages: [{
      from: config.INFOBIP_VIBER_SENDER,
      destinations: [{ to }],
      content: { body: message, type: 'TEXT' },
    }],
  })
}
