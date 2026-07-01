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

export async function generateCampaignCopy(
  product: ShopifyProduct,
  customer: ShopifyCustomer,
  orders: ShopifyOrder[],
): Promise<CampaignCopy> {
  const orderHistory = orders.length
    ? orders.map(o => o.line_items.map(i => `${i.title} (${i.quantity}x)`).join(', ')).join(' | ')
    : 'nema prethodnih narudžbina'

  const price = product.variants[0]?.price ?? 'N/A'
  const description = product.body_html.replace(/<[^>]+>/g, '').trim()

  const isRepeatCustomer = orders.length > 0

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    system: `Ti si copywriter za Geezer Collection — srpski brend muške mode.

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

Pišeš na srpskom. Obraćaš se sa "ti" (neformalno).`,
    tools: [{
      name: 'campaign_copy',
      description: 'Structured marketing campaign copy for email, SMS, and WhatsApp',
      input_schema: {
        type: 'object' as const,
        properties: {
          email: {
            type: 'object',
            properties: {
              subject: { type: 'string', description: 'Email subject line' },
              body: { type: 'string', description: 'Plain text email body, 3-5 sentences max' },
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
              message: { type: 'string', description: 'WhatsApp message with emojis, 2-3 sentences' },
            },
            required: ['message'],
          },
          viber: {
            type: 'object',
            properties: {
              message: { type: 'string', description: 'Viber message, friendly tone, 2-3 sentences, emojis OK' },
            },
            required: ['message'],
          },
        },
        required: ['email', 'sms', 'whatsapp', 'viber'],
      },
    }],
    tool_choice: { type: 'tool', name: 'campaign_copy' },
    messages: [{
      role: 'user',
      content: `Novi proizvod: ${product.title} — ${price} RSD
Opis: ${description}
Kupac: ${customer.first_name} ${customer.last_name}
Prethodne kupovine: ${orderHistory}
Tip kupca: ${isRepeatCustomer ? 'postojeći kupac (Tip 1 ili 2 — ima iskustva s brendom)' : 'novi kupac (Tip 3 — prvo obraćanje, fokus na autentičnost i odrastao stil)'}

Napiši personalizovanu kampanju za email, SMS (max 160 karaktera), WhatsApp i Viber.
Koristi pravo ime kupca (${customer.first_name}). Prilagodi ugao tipa kupca. Budi konkretan oko ovog proizvoda.`,
    }],
  })

  const toolUse = message.content.find(b => b.type === 'tool_use')
  if (!toolUse || toolUse.type !== 'tool_use') throw new Error('No tool_use block in response')
  return toolUse.input as CampaignCopy
}
