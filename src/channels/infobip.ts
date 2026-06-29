import config from '../config.js'

function baseUrl(): string {
  const url = config.INFOBIP_BASE_URL
  return url.startsWith('http') ? url : `https://${url}`
}

export async function infobipFetch(path: string, body: unknown): Promise<void> {
  const res = await fetch(`${baseUrl()}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `App ${config.INFOBIP_API_KEY}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Infobip ${path}: ${res.status} ${await res.text()}`)
}
