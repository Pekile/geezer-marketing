import config from '../config.js'

function baseUrl(): string {
  const url = config.INFOBIP_BASE_URL
  return url.startsWith('http') ? url : `https://${url}`
}

export function normalizePhone(phone: string): string {
  return phone.replace(/^\+/, '').replace(/\s/g, '')
}

export function testPhone(): string | null {
  return config.TEST_RECIPIENT_PHONE ? normalizePhone(config.TEST_RECIPIENT_PHONE) : null
}

export function testEmail(): string | null {
  return config.TEST_RECIPIENT_EMAIL || null
}

export async function infobipFetch(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${baseUrl()}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `App ${config.INFOBIP_API_KEY}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`Infobip ${path}: ${res.status} ${text}`)
  console.log(`[infobip] ${path} →`, text)
  return JSON.parse(text)
}
