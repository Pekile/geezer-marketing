import config from '../config.js'

// Meta Cloud API freeform messages only work within a 24h customer service window.
// For outbound product announcements, set up approved message templates in
// Meta Business Manager and switch to template messages here.
export async function sendWhatsApp(to: string, message: string): Promise<void> {
  if (!config.WHATSAPP_ACCESS_TOKEN) {
    console.log(`[whatsapp:mock] to=${to} | ${message}`)
    return
  }
  const res = await fetch(
    `https://graph.facebook.com/v18.0/${config.WHATSAPP_PHONE_NUMBER_ID}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: message },
      }),
    },
  )
  if (!res.ok) throw new Error(`WhatsApp error: ${res.status} ${await res.text()}`)
}
