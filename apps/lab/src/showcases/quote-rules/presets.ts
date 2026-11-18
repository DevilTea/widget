/**
 * Quote ("Corner Press print job") preset source texts.
 *
 * Each preset is plain JSON source text that goes through the exact same Apply pipeline as manual editing
 * (`LabSession.applyPreset`): no bypass of `JSON.parse` or `WidgetSystem.createBlueprint`. Only Core's recognized
 * widget keys (`id`, `type`, `config`, `slots`) appear.
 *
 * - `quote-default`: valid. Three items, a volume discount, a rush surcharge, a delivery fee and a sales tax.
 *   The chain of declared dependencies: `<item>.line` -> `quote.subtotalCents` / `quote.totalQuantity` ->
 *   `volume|rush|delivery.adjustment` -> `quote.taxableCents` -> `tax.adjustment` -> `quote.quote`.
 * - `quote-invalid`: "a draft with mistakes", where the schema library (Valibot, through Standard Schema) does the
 *   talking: one or two mistakes per widget, so the diagnostics do not hide one another. Each is the library's own
 *   message at the place it was found.
 * - `quote-buggy-rule`: a *valid* document whose volume tiers start at 100 instead of 1. The schema allows that;
 *   the rule's code does not (see `plugins/volume-discount.ts`): while the total quantity is 100 or more it
 *   prices fine, and when a customer lowers it the rule throws. A document cannot contain code, so the defect is
 *   in the plugin and the preset is the data that reaches it.
 */

export interface QuotePreset {
	readonly id: string
	readonly label: string
	readonly description: string
	readonly sourceText: string
}

const DEFAULT_SOURCE = `{
  "id": "quote",
  "type": "Quote",
  "config": { "title": { "en": "Corner Press: print job", "zh-TW": "轉角印刷：印製報價" }, "currency": "EUR" },
  "slots": {
    "items": [
      {
        "id": "flyers",
        "type": "Item",
        "config": {
          "title": { "en": "A5 flyers", "zh-TW": "A5 傳單" },
          "unitCents": 9,
          "quantity": 500,
          "paper": "standard",
          "papers": {
            "standard": { "label": { "en": "Standard 90 g", "zh-TW": "標準 90 g" }, "extraCents": 0 },
            "recycled": { "label": { "en": "Recycled 100 g", "zh-TW": "再生紙 100 g" }, "extraCents": 1 },
            "gloss": { "label": { "en": "Gloss 130 g", "zh-TW": "亮面 130 g" }, "extraCents": 3 }
          }
        }
      },
      {
        "id": "cards",
        "type": "Item",
        "config": {
          "title": { "en": "Business cards", "zh-TW": "名片" },
          "unitCents": 14,
          "quantity": 250,
          "paper": "standard",
          "papers": {
            "standard": { "label": { "en": "Standard 350 g", "zh-TW": "標準 350 g" }, "extraCents": 0 },
            "linen": { "label": { "en": "Linen 300 g", "zh-TW": "亞麻紋 300 g" }, "extraCents": 6 }
          }
        }
      },
      {
        "id": "poster",
        "type": "Item",
        "config": {
          "title": { "en": "A2 poster", "zh-TW": "A2 海報" },
          "unitCents": 1450,
          "quantity": 2,
          "paper": "matt",
          "papers": {
            "matt": { "label": { "en": "Matt 170 g", "zh-TW": "霧面 170 g" }, "extraCents": 0 },
            "photo": { "label": { "en": "Photo satin", "zh-TW": "相紙緞面" }, "extraCents": 450 }
          }
        }
      }
    ],
    "rules": [
      {
        "id": "volume",
        "type": "VolumeDiscount",
        "config": {
          "label": { "en": "Volume discount", "zh-TW": "數量折扣" },
          "tiers": [
            { "minQuantity": 1, "percent": 0 },
            { "minQuantity": 300, "percent": 5 },
            { "minQuantity": 1000, "percent": 10 }
          ]
        }
      },
      {
        "id": "rush",
        "type": "RushSurcharge",
        "config": { "label": { "en": "Rush production", "zh-TW": "急件加價" }, "percent": 25 }
      },
      {
        "id": "delivery",
        "type": "Delivery",
        "config": { "label": { "en": "Delivery", "zh-TW": "運送" }, "courierCents": 900, "freeOverCents": 20000 }
      },
      {
        "id": "tax",
        "type": "SalesTax",
        "config": { "label": { "en": "Sales tax", "zh-TW": "營業稅" }, "percent": 21 }
      }
    ]
  }
}
`

// One or two mistakes per widget. The text of each one is Valibot's, not ours.
const INVALID_SOURCE = `{
  "id": "quote",
  "type": "Quote",
  "config": { "title": { "en": "Corner Press: print job" }, "currency": "euro" },
  "slots": {
    "items": [
      {
        "id": "flyers",
        "type": "Item",
        "config": {
          "title": { "en": "A5 flyers" },
          "unitCents": "9",
          "quantity": 500,
          "papers": { "standard": { "label": { "en": "Standard 90 g" }, "extraCents": 0 } }
        }
      },
      {
        "id": "cards",
        "type": "Item",
        "config": {
          "title": { "en": "Business cards" },
          "unitCents": 14,
          "quantity": 2.5,
          "papers": { "standard": { "label": { "en": "Standard 350 g" }, "extraCents": 0 } },
          "finish": "matt"
        }
      }
    ],
    "rules": [
      {
        "id": "volume",
        "type": "VolumeDiscount",
        "config": {
          "label": { "en": "Volume discount" },
          "tiers": [{ "minQuantity": 1, "percent": 0 }, { "minQuantity": 300, "percent": 120 }]
        }
      },
      {
        "id": "rush",
        "type": "RushSurcharge",
        "config": { "label": { "zh-TW": "急件加價" }, "percent": 25 }
      },
      {
        "id": "tax",
        "type": "SalesTax",
        "config": { "label": { "en": "Sales tax" }, "percent": 21 }
      }
    ]
  }
}
`

const BUGGY_SOURCE = `{
  "id": "quote",
  "type": "Quote",
  "config": { "title": { "en": "Corner Press: print job (volume tiers from 100)", "zh-TW": "轉角印刷：印製報價（數量折扣從 100 起）" }, "currency": "EUR" },
  "slots": {
    "items": [
      {
        "id": "flyers",
        "type": "Item",
        "config": {
          "title": { "en": "A5 flyers", "zh-TW": "A5 傳單" },
          "unitCents": 9,
          "quantity": 120,
          "paper": "standard",
          "papers": {
            "standard": { "label": { "en": "Standard 90 g", "zh-TW": "標準 90 g" }, "extraCents": 0 },
            "gloss": { "label": { "en": "Gloss 130 g", "zh-TW": "亮面 130 g" }, "extraCents": 3 }
          }
        }
      },
      {
        "id": "poster",
        "type": "Item",
        "config": {
          "title": { "en": "A2 poster", "zh-TW": "A2 海報" },
          "unitCents": 1450,
          "quantity": 2,
          "paper": "matt",
          "papers": { "matt": { "label": { "en": "Matt 170 g", "zh-TW": "霧面 170 g" }, "extraCents": 0 } }
        }
      }
    ],
    "rules": [
      {
        "id": "volume",
        "type": "VolumeDiscount",
        "config": {
          "label": { "en": "Volume discount", "zh-TW": "數量折扣" },
          "tiers": [
            { "minQuantity": 100, "percent": 5 },
            { "minQuantity": 500, "percent": 10 }
          ]
        }
      },
      {
        "id": "delivery",
        "type": "Delivery",
        "config": { "label": { "en": "Delivery", "zh-TW": "運送" }, "courierCents": 900 }
      },
      {
        "id": "tax",
        "type": "SalesTax",
        "config": { "label": { "en": "Sales tax", "zh-TW": "營業稅" }, "percent": 21 }
      }
    ]
  }
}
`

export const quotePresets: readonly QuotePreset[] = [
	{
		id: 'quote-default',
		label: 'Default — Corner Press print job',
		description: 'A valid quote: three printed items, a volume discount, a rush surcharge, a delivery fee and a sales tax, all priced by rule widgets, and the same document priced again in a Web Worker.',
		sourceText: DEFAULT_SOURCE,
	},
	{
		id: 'quote-invalid',
		label: 'Invalid config — schema library diagnostics',
		description: 'The default with mistakes in the configs of five widgets. Valibot, through Standard Schema, finds each one and its own message becomes the Core diagnostic, verbatim and at the place it was found.',
		sourceText: INVALID_SOURCE,
	},
	{
		id: 'quote-buggy-rule',
		label: 'Buggy rule — an isolated exception',
		description: 'A valid document whose volume tiers start at 100. The rule\'s code assumes the first tier starts at 1, so lowering the total quantity below 100 makes it throw: Core isolates the exception and the Preview reports it instead of crashing.',
		sourceText: BUGGY_SOURCE,
	},
]

export const defaultQuotePreset: QuotePreset = quotePresets[0]!
