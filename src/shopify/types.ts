export interface ShopifyProduct {
  id: number
  title: string
  body_html: string
  handle: string
  images: { src: string }[]
  variants: { price: string }[]
}

export interface ShopifyCustomer {
  id: number
  first_name: string
  last_name: string
  email: string
  phone: string | null
  email_marketing_consent: { state: 'subscribed' | 'unsubscribed' | 'pending' | 'not_subscribed' }
  sms_marketing_consent: { state: 'subscribed' | 'unsubscribed' | 'pending' | 'not_subscribed' } | null
}

export interface ShopifyOrder {
  id: number
  name: string
  line_items: { title: string; quantity: number }[]
  created_at: string
}
