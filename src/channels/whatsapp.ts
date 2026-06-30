import config from '../config.js'
import { infobipFetch, normalizePhone } from './infobip.js'

// WhatsApp Business requires pre-approved templates for all outbound messages.
// Free trial: sender=447860088970, template=test_whatsapp_template_en, fixed recipient only.
// Production: register your own number + create Serbian marketing templates in Infobip.
export async function sendWhatsApp(to: string, firstName: string): Promise<void> {
  const recipient = config.TEST_RECIPIENT_WHATSAPP || normalizePhone(to)

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
        templateData: { body: { placeholders: [firstName] } },
        language: 'en',
      },
    }],
  })

  if (config.TEST_RECIPIENT_WHATSAPP) {
    console.log(`[whatsapp:test] sent to ${recipient} (real recipient: ${to})`)
  }
}
