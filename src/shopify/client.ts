import config from '../config.js'
import type { ShopifyCustomer, ShopifyOrder } from './types.js'

const BASE = `https://${config.SHOPIFY_STORE_DOMAIN}/admin/api/2024-01`
const CUSTOMER_FIELDS = 'id,first_name,last_name,email,phone,email_marketing_consent,sms_marketing_consent'

async function shopifyFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'X-Shopify-Access-Token': config.SHOPIFY_ADMIN_API_TOKEN },
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
  const all: ShopifyCustomer[] = []
  let pageInfo: string | null = null

  do {
    const path = pageInfo
      ? `/customers.json?limit=250&page_info=${pageInfo}&fields=${CUSTOMER_FIELDS}`
      : `/customers.json?limit=250&fields=${CUSTOMER_FIELDS}`

    const res = await fetch(`${BASE}${path}`, {
      headers: { 'X-Shopify-Access-Token': config.SHOPIFY_ADMIN_API_TOKEN },
    })
    if (!res.ok) throw new Error(`Shopify customers: ${res.status} ${await res.text()}`)

    const data = await res.json() as { customers: ShopifyCustomer[] }
    all.push(...data.customers)
    console.log(`[shopify] fetched ${all.length} customers so far...`)

    pageInfo = parseNextPageInfo(res.headers.get('link'))
  } while (pageInfo)

  const opted = all.filter(c =>
    c.email_marketing_consent?.state === 'subscribed' ||
    c.sms_marketing_consent?.state === 'subscribed',
  )
  console.log(`[shopify] ${all.length} total customers, ${opted.length} opted-in`)
  return opted
}

export async function getCustomerOrders(customerId: number): Promise<ShopifyOrder[]> {
  const data = await shopifyFetch<{ orders: ShopifyOrder[] }>(
    `/customers/${customerId}/orders.json?limit=5&status=any&fields=id,name,line_items,created_at`,
  )
  return data.orders
}
