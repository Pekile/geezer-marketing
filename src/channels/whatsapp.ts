import config from '../config.js'
import { infobipFetch, normalizePhone, testPhone } from './infobip.js'

// WhatsApp Business requires pre-approved templates for all outbound messages.
// The geezer_marketing template must be approved by Meta via Infobip before
// messages are delivered — Infobip accepts the call but WhatsApp rejects unnapproved templates.
export async function sendWhatsApp(to: string, message: string): Promise<void> {
  // Fall back to TEST_RECIPIENT_PHONE if the WhatsApp-specific override isn't set.
  const testRecipient = config.TEST_RECIPIENT_WHATSAPP
    ? normalizePhone(config.TEST_RECIPIENT_WHATSAPP)
    : testPhone()
  const recipient = testRecipient ?? normalizePhone(to)

  if (!config.INFOBIP_API_KEY || !config.INFOBIP_WHATSAPP_SENDER) {
    console.log(`[whatsapp:mock] to=${recipient}`)
    return
  }

  await infobipFetch('/whatsapp/1/message/template', {
    messages: [{
      from: config.INFOBIP_WHATSAPP_SENDER,
      to: recipient,
      content: {
        templateName: config.INFOBIP_WHATSAPP_TEMPLATE,
        templateData: { body: { placeholders: [message] } },
        language: 'sr',
      },
    }],
  })

  if (testRecipient) {
    console.log(`[whatsapp:test] sent to ${recipient} (real recipient: ${to})`)
  }
}
