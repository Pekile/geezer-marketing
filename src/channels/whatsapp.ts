import config from '../config.js'
import { infobipFetch } from './infobip.js'

// Infobip WhatsApp text message (works within a 24h customer service window).
// For outbound marketing campaigns, register a template in Infobip and switch
// to /whatsapp/1/message/template with the approved template name.
export async function sendWhatsApp(to: string, message: string): Promise<void> {
  if (!config.INFOBIP_API_KEY || !config.INFOBIP_WHATSAPP_SENDER) {
    console.log(`[whatsapp:mock] to=${to} | ${message}`)
    return
  }
  await infobipFetch('/whatsapp/1/message/text', {
    from: config.INFOBIP_WHATSAPP_SENDER,
    to,
    content: { text: message },
  })
}
