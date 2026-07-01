import Anthropic from '@anthropic-ai/sdk'
import config from '../config.js'
import type { ShopifyCustomer, ShopifyOrder, ShopifyProduct } from '../shopify/types.js'

const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY })

export interface CampaignCopy {
  email: { subject: string; body: string }
  sms: { message: string }
  whatsapp: { message: string }
  viber: { message: string }
}

const SYSTEM_PROMPT = `Ti si copywriter za Geezer Collection — srpski brend muške mode.

## Šta je Geezer

Nije fashion brand. Nije trend. Nije fensi.
Geezer je odeća za život — za muškarca koji ne razmišlja šta će da obuče, a uvek izgleda kako treba.
Jedan komad. Više situacija. Traje.

## Tri tipa kupca — prepoznaj i prilagodi ton

**Tip 1 — Porodični muškarac (25–45)**
Radi, ima obaveze, nema vremena za gluposti. Prodaj mu sigurnost i jednostavnost.
Poruka: obučeš → izgledaš normalno, muški, sređeno. Ne gužva se, ne raspada se posle 5 pranja.

**Tip 2 — Muškarac sa stavom**
Ne nosi logo preko cele grudi. Ne mora ništa da dokazuje. Ceni tišinu, kvalitet i meru.
Poruka: snaga je tiha. Nema vrištanja, nema cirkusa. Nosiš jer ti prija, ne jer je trend.
Rečenica koja rezonuje: "Ne moraš da se vidiš da bi se znao."

**Tip 3 — Mladi (20–30) koji beže od krindža**
Smučila im se fast fashion priča. Hoće autentičnost — ali ne previše. Hoće odraslo, ne Instagram-karneval.
Poruka: jednostavno = ozbiljno. Domaći brend, ali ne seljački. Prvi korak ka odraslom stilu.

Ako kupac nema prethodnih narudžbina → verovatno novi/mlađi → Tip 3.
Ako ima istoriju kupovine → Tip 1 ili Tip 2, biraj prema kontekstu.

## Šta Srbija kupuje — 3 okidača

1. **Vređanje loše navike**: "Zašto nosiš nešto što se raspadne za sezonu?" Ne moraš 10 majica. Ne moraš trend. Manje komada = više smisla.
2. **Argument kvaliteta (konkretno, ne apstraktno)**: deblji pamuk, drži formu, ne razvlači se, ne izgleda jeftino posle pranja. "Uzmeš – nosiš – ne misliš."
3. **Dugoročna računica**: fast fashion je jeftino danas, skupo kroz nerviranje. Kupiš jednom, nosiš stalno, izgledaš isto dobro i posle godinu dana.

## Ključne poruke brenda

- Geezer zamenjuje: "šta da obučem", 5 loših majica za jednu dobru, razmišljanje pred ormarom
- Šta zapravo dobijaju: mir u glavi, jednostavnost, tiho samopouzdanje, osećaj "ovo sam ja"
- Ne kupuju majicu. Kupuju osećaj kontrole.

## Mini priča koja funkcioniše

Nedelja. Grad. Kafa. Obukao si isto što i juče – ali izgledaš bolje.
Niko te ne pita gde si kupio. Ali te gledaju drugačije.
Ne zato što si glasan. Nego zato što si miran.

## Ton — šta da NIKAD ne piše

❌ "premium feel" ❌ "carefully crafted" ❌ "luksuzno" ❌ "ekskluzivno" ❌ "fashion"
❌ Instagram-superlative ❌ previše uzvičnika ❌ pretenciozno ❌ seljački ❌ krinž trendovi

## Ton — šta JESTE Geezer

✅ direktno ✅ muški ✅ tiho samopouzdanje ✅ konkretno ✅ srpski bez prevoda
✅ kratko i jasno ✅ bez viška reči ✅ kao razgovor s prijateljem koji zna šta priča

## Format po kanalu

**Email**: mini priča + konkretna korist + poziv na akciju. Može 4–6 rečenica. Subject: direktan, bez clickbait-a.
**SMS**: max 160 karaktera, jedna snažna ideja, bez maženja. Završi linkom ako ima.
**WhatsApp**: 2–3 rečenice, prijateljski ali ne ulizički. Emoji OK, ali max 2–3.
**Viber**: isto kao WhatsApp. Toplo, konkretno, kratko.

Pišeš na srpskom. Obraćaš se sa "ti" (neformalno).`

export type CustomerWithOrders = {
  customer: ShopifyCustomer
  orders: ShopifyOrder[]
}

/**
 * Generates copy for up to ~10 customers in a single Claude API call.
 * Returns one CampaignCopy per customer in the same order as input.
 * Much faster than one API call per customer for large customer lists.
 */
export async function generateCampaignCopyBatch(
  product: ShopifyProduct,
  batch: CustomerWithOrders[],
): Promise<CampaignCopy[]> {
  const price = product.variants[0]?.price ?? 'N/A'
  const description = product.body_html.replace(/<[^>]+>/g, '').trim()

  const customerDescriptions = batch.map(({ customer, orders }, idx) => {
    const orderHistory = orders.length
      ? orders.map(o => o.line_items.map(i => `${i.title} (${i.quantity}x)`).join(', ')).join(' | ')
      : 'nema prethodnih narudžbina'
    const isRepeatCustomer = orders.length > 0
    return `Kupac ${idx + 1}: ${customer.first_name} ${customer.last_name}
Prethodne kupovine: ${orderHistory}
Tip: ${isRepeatCustomer ? 'postojeći (Tip 1 ili 2)' : 'novi (Tip 3)'}`
  }).join('\n\n')

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 6000,
    system: SYSTEM_PROMPT,
    tools: [{
      name: 'campaign_copies',
      description: 'Batch marketing copy for multiple customers, in the same order as input',
      input_schema: {
        type: 'object' as const,
        properties: {
          copies: {
            type: 'array',
            description: 'One entry per customer, same order as input',
            items: {
              type: 'object',
              properties: {
                email: {
                  type: 'object',
                  properties: {
                    subject: { type: 'string', description: 'Email subject line' },
                    body: { type: 'string', description: 'Plain text email body, 4–6 sentences' },
                  },
                  required: ['subject', 'body'],
                },
                sms: {
                  type: 'object',
                  properties: {
                    message: { type: 'string', description: 'SMS text, max 160 characters' },
                  },
                  required: ['message'],
                },
                whatsapp: {
                  type: 'object',
                  properties: {
                    message: { type: 'string', description: 'WhatsApp message, 2–3 sentences, max 2–3 emojis' },
                  },
                  required: ['message'],
                },
                viber: {
                  type: 'object',
                  properties: {
                    message: { type: 'string', description: 'Viber message, friendly, 2–3 sentences, emojis OK' },
                  },
                  required: ['message'],
                },
              },
              required: ['email', 'sms', 'whatsapp', 'viber'],
            },
          },
        },
        required: ['copies'],
      },
    }],
    tool_choice: { type: 'tool', name: 'campaign_copies' },
    messages: [{
      role: 'user',
      content: `Novi proizvod: ${product.title} — ${price} RSD
Opis: ${description}

Napiši personalizovanu kampanju za ${batch.length} kupca (u datom redosledu):

${customerDescriptions}

Za svakog kupca vrati email (naslov + telo), SMS (max 160 kar.), WhatsApp i Viber poruku.
Koristi pravo ime kupca. Prilagodi ton tipu kupca. Budi konkretan oko ovog proizvoda.`,
    }],
  })

  const toolUse = message.content.find(b => b.type === 'tool_use')
  if (!toolUse || toolUse.type !== 'tool_use') throw new Error('No tool_use block in batch response')
  const result = toolUse.input as { copies: CampaignCopy[] }
  if (!Array.isArray(result.copies)) throw new Error('Invalid batch response: copies is not an array')
  return result.copies
}
