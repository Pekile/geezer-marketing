import config from '../config.js'
import type { ShopifyCustomer, ShopifyOrder, ShopifyProduct } from './types.js'

const BASE = `https://${config.SHOPIFY_STORE_DOMAIN}/admin/api/2024-01`
const CUSTOMER_FIELDS = 'id,first_name,last_name,email,phone,email_marketing_consent,sms_marketing_consent'

// Cache token for the lifetime of this function invocation
let cachedToken: string | null = null

async function getToken(): Promise<string> {
  if (cachedToken) return cachedToken

  // Use static token if no client credentials configured
  if (!config.SHOPIFY_CLIENT_ID || !config.SHOPIFY_CLIENT_SECRET) {
    if (!config.SHOPIFY_ADMIN_API_TOKEN) throw new Error('No Shopify credentials configured')
    return config.SHOPIFY_ADMIN_API_TOKEN
  }

  const res = await fetch(`https://${config.SHOPIFY_STORE_DOMAIN}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: config.SHOPIFY_CLIENT_ID,
      client_secret: config.SHOPIFY_CLIENT_SECRET,
    }),
  })

  if (!res.ok) throw new Error(`Shopify token refresh failed: ${res.status} ${await res.text()}`)

  const data = await res.json() as { access_token: string }
  cachedToken = data.access_token
  console.log('[shopify] refreshed access token')
  return cachedToken
}

async function shopifyFetch<T>(path: string): Promise<T> {
  const token = await getToken()
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'X-Shopify-Access-Token': token },
  })
  if (!res.ok) throw new Error(`Shopify ${path}: ${res.status} ${await res.text()}`)
  return res.json() as Promise<T>
}

function parseNextPageInfo(linkHeader: string | null): string | null {
  if (!linkHeader) return null
  const match = linkHeader.match(/<[^>]*[?&]page_info=([^&>]+)[^>]*>;\s*rel="next"/)
  return match ? match[1] : null
}

export async function getOptedInCustomers(): Promise<ShopifyCustomer[]> {
  const token = await getToken()
  const all: ShopifyCustomer[] = []
  let pageInfo: string | null = null

  do {
    const path = pageInfo
      ? `/customers.json?limit=250&page_info=${pageInfo}&fields=${CUSTOMER_FIELDS}`
      : `/customers.json?limit=250&fields=${CUSTOMER_FIELDS}`

    const res = await fetch(`${BASE}${path}`, {
      headers: { 'X-Shopify-Access-Token': token },
    })
    if (!res.ok) throw new Error(`Shopify customers: ${res.status} ${await res.text()}`)

    const data = await res.json() as { customers: ShopifyCustomer[] }
    all.push(...data.customers)
    console.log(`[shopify] fetched ${all.length} customers so far...`)

    pageInfo = parseNextPageInfo(res.headers.get('link'))
  } while (pageInfo)

  console.log(`[shopify] ${all.length} total customers`)
  return all
}

export async function getProduct(productId: string): Promise<ShopifyProduct> {
  const data = await shopifyFetch<{ product: ShopifyProduct }>(
    `/products/${productId}.json`,
  )
  return data.product
}

export async function getCustomerOrders(customerId: number): Promise<ShopifyOrder[]> {
  const data = await shopifyFetch<{ orders: ShopifyOrder[] }>(
    `/customers/${customerId}/orders.json?limit=5&status=any&fields=id,name,line_items,created_at`,
  )
  return data.orders
}
