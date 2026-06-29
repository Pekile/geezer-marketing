import config from '../config.js'
import type { ShopifyCustomer, ShopifyOrder } from './types.js'

const BASE = `https://${config.SHOPIFY_STORE_DOMAIN}/admin/api/2024-01`

async function shopifyFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'X-Shopify-Access-Token': config.SHOPIFY_ADMIN_API_TOKEN },
  })
  if (!res.ok) throw new Error(`Shopify ${path}: ${res.status} ${await res.text()}`)
  return res.json() as Promise<T>
}

export async function getOptedInCustomers(): Promise<ShopifyCustomer[]> {
  const customers: ShopifyCustomer[] = []
  let pageInfo: string | null = null

  do {
    const query = pageInfo
      ? `/customers.json?limit=250&page_info=${pageInfo}&fields=id,first_name,last_name,email,phone,email_marketing_consent,sms_marketing_consent`
      : `/customers.json?limit=250&fields=id,first_name,last_name,email,phone,email_marketing_consent,sms_marketing_consent`

    const data = await shopifyFetch<{ customers: ShopifyCustomer[] }>(query)
    customers.push(...data.customers)
    pageInfo = null // Shopify REST cursor pagination requires Link header — simplified for now
  } while (pageInfo)

  return customers.filter(c =>
    c.email_marketing_consent?.state === 'subscribed' ||
    c.sms_marketing_consent?.state === 'subscribed',
  )
}

export async function getCustomerOrders(customerId: number): Promise<ShopifyOrder[]> {
  const data = await shopifyFetch<{ orders: ShopifyOrder[] }>(
    `/customers/${customerId}/orders.json?limit=5&status=any&fields=id,name,line_items,created_at`,
  )
  return data.orders
}
