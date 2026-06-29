import config from '../config.js'

export async function sendSms(to: string, message: string): Promise<void> {
  if (!config.INFOBIP_API_KEY) {
    console.log(`[sms:mock] to=${to} | ${message}`)
    return
  }
  const res = await fetch(`${config.INFOBIP_BASE_URL}/sms/2/text/advanced`, {
    method: 'POST',
    headers: {
      Authorization: `App ${config.INFOBIP_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messages: [{ from: config.INFOBIP_SENDER_NAME, destinations: [{ to }], text: message }],
    }),
  })
  if (!res.ok) throw new Error(`Infobip error: ${res.status} ${await res.text()}`)
}
