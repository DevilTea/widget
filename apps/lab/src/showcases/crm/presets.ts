/**
 * Showcase B ("Interactive Product Prototype") preset source text (checkpoint §6).
 *
 * One primary valid interactive preset, following the checkpoint's source topology draft verbatim —
 * exact widget ids, slot names, and config wiring (`storeId`/`searchInputId`/`stageFilterId`/`source`/
 * `rowIdKey`/`tableId`/`stageInputId`/`modalId`/`action` all match §6's listing). Like Showcase A's
 * presets, this is plain JSON source text that goes through the exact same Apply pipeline as manual
 * editing (`LabSession.applyPreset`) — no bypass of `JSON.parse` or `WidgetSystem.createBlueprint`.
 */

import { dealStageValues, seedDeals } from './domain'

export interface CrmPreset {
	readonly id: string
	readonly label: string
	readonly description: string
	readonly sourceText: string
}

const stageOptionLabels: Readonly<Record<string, string>> = {
	lead: 'Lead',
	qualified: 'Qualified',
	proposal: 'Proposal',
	negotiation: 'Negotiation',
	won: 'Won',
	lost: 'Lost',
}

const stageOnlyOptionsJson = JSON.stringify(dealStageValues.map(stage => ({ value: stage, label: stageOptionLabels[stage] })))
const stageFilterOptionsJson = JSON.stringify([{ value: 'all', label: 'All stages' }, ...dealStageValues.map(stage => ({ value: stage, label: stageOptionLabels[stage] }))])
const seedDealsJson = JSON.stringify(seedDeals)

const crmSource = `{
  "id": "crm-app",
  "type": "AppShell",
  "config": { "title": "Sales Pipeline CRM", "subtitle": "Interactive Product Prototype" },
  "slots": {
    "header": [
      {
        "id": "crm-toolbar",
        "type": "Toolbar",
        "slots": {
          "start": [
            { "id": "deal-search", "type": "TextInput", "config": { "label": "Search", "placeholder": "Search company, contact, or owner", "default": "", "maxLength": 80 } },
            { "id": "stage-filter", "type": "SelectInput", "config": { "label": "Stage", "options": ${stageFilterOptionsJson}, "default": "all" } }
          ],
          "end": [
            { "id": "reset-data", "type": "Button", "config": { "label": "Reset data", "kind": "secondary", "action": { "widgetId": "deal-store", "method": "reset" } } }
          ]
        }
      }
    ],
    "main": [
      { "id": "deal-store", "type": "DealStore", "config": { "seedDeals": ${seedDealsJson} } },
      { "id": "deal-query", "type": "DealQuery", "config": { "storeId": "deal-store", "searchInputId": "deal-search", "stageFilterId": "stage-filter" } },
      {
        "id": "metrics-card",
        "type": "Card",
        "config": { "title": "Pipeline metrics" },
        "slots": {
          "body": [
            { "id": "visible-deal-count", "type": "MetricCard", "config": { "label": "Visible deals", "source": { "widgetId": "deal-query", "property": "count" }, "format": "number" } },
            { "id": "pipeline-value", "type": "MetricCard", "config": { "label": "Pipeline value", "source": { "widgetId": "deal-query", "property": "pipelineValue" }, "format": "currency" } },
            { "id": "weighted-value", "type": "MetricCard", "config": { "label": "Weighted value", "source": { "widgetId": "deal-query", "property": "weightedValue" }, "format": "currency" } }
          ]
        }
      },
      {
        "id": "pipeline-chart-card",
        "type": "Card",
        "config": { "title": "Pipeline by stage" },
        "slots": {
          "body": [
            { "id": "stage-chart", "type": "BarChart", "config": { "title": "Deals by stage", "source": { "widgetId": "deal-query", "property": "stageSeries" } } }
          ]
        }
      },
      {
        "id": "deals-card",
        "type": "Card",
        "config": { "title": "Deals" },
        "slots": {
          "body": [
            {
              "id": "deal-table",
              "type": "Table",
              "config": {
                "source": { "widgetId": "deal-query", "property": "filteredDeals" },
                "rowIdKey": "id",
                "columns": [
                  { "key": "company", "label": "Company" },
                  { "key": "contact", "label": "Contact" },
                  { "key": "owner", "label": "Owner" },
                  { "key": "stage", "label": "Stage", "format": "badge" },
                  { "key": "amount", "label": "Amount", "format": "currency" }
                ]
              }
            }
          ]
        }
      },
      {
        "id": "deal-detail",
        "type": "DetailPanel",
        "config": {
          "title": "Deal details",
          "source": { "widgetId": "deal-table", "property": "selectedRow" },
          "fields": [
            { "key": "company", "label": "Company" },
            { "key": "contact", "label": "Contact" },
            { "key": "owner", "label": "Owner" },
            { "key": "stage", "label": "Stage", "format": "badge" },
            { "key": "amount", "label": "Amount", "format": "currency" }
          ],
          "emptyText": "Select a deal from the table to see its details."
        },
        "slots": {
          "actions": [
            { "id": "change-stage", "type": "Button", "config": { "label": "Change stage", "kind": "primary", "action": { "widgetId": "deal-stage-form", "method": "open" } } }
          ]
        }
      }
    ],
    "overlay": [
      {
        "id": "stage-modal",
        "type": "Modal",
        "config": { "title": "Change deal stage" },
        "slots": {
          "body": [
            {
              "id": "deal-stage-form",
              "type": "DealStageForm",
              "config": { "storeId": "deal-store", "tableId": "deal-table", "stageInputId": "stage-editor", "modalId": "stage-modal" },
              "slots": {
                "fields": [
                  { "id": "stage-editor", "type": "SelectInput", "config": { "label": "New stage", "options": ${stageOnlyOptionsJson}, "default": "lead" } }
                ],
                "actions": [
                  { "id": "save-stage", "type": "Button", "config": { "label": "Save", "kind": "primary", "action": { "widgetId": "deal-stage-form", "method": "save" } } },
                  { "id": "cancel-stage", "type": "Button", "config": { "label": "Cancel", "kind": "secondary", "action": { "widgetId": "deal-stage-form", "method": "cancel" } } }
                ]
              }
            }
          ],
          "footer": []
        }
      }
    ]
  }
}
`

export const crmPresets: readonly CrmPreset[] = [
	{
		id: 'crm-default',
		label: 'Default — Sales Pipeline CRM',
		description: 'The canonical valid Interactive Product Prototype source (checkpoint §6): the exact source topology draft, widget ids, and config wiring, over the canonical eight-deal seed dataset.',
		sourceText: crmSource,
	},
]

export const defaultCrmPreset: CrmPreset = crmPresets[0]!
