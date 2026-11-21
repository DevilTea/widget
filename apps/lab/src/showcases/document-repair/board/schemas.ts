/**
 * Draft 2020-12 JSON Schemas of the notice board plugins' configs (passive authoring metadata; the checkers in
 * `./config.ts` enforce the rest, such as `until` being a real calendar date).
 */

import type { WidgetConfigJsonSchema } from '@deviltea/widget-core'
import { WIDGET_CONFIG_JSON_SCHEMA_DIALECT } from '@deviltea/widget-core'
import { TONES } from '../domain'

export const boardConfigSchema = {
	$schema: WIDGET_CONFIG_JSON_SCHEMA_DIALECT,
	type: 'object',
	additionalProperties: false,
	required: ['title'],
	properties: {
		title: {
			type: 'object',
			required: ['en'],
			additionalProperties: { type: 'string' },
			description: 'The title of the board per language, such as { "en": "Notices", "zh-TW": "公告" }.',
		},
	},
} as const satisfies WidgetConfigJsonSchema

export const noticeConfigSchema = {
	$schema: WIDGET_CONFIG_JSON_SCHEMA_DIALECT,
	type: 'object',
	additionalProperties: false,
	required: ['title', 'body', 'until', 'tone'],
	properties: {
		title: { type: 'string', minLength: 1, description: 'The headline of the notice.' },
		body: { type: 'string', description: 'The text of the notice.' },
		until: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'The last day the notice is shown, written YYYY-MM-DD.' },
		tone: { type: 'string', enum: [...TONES], description: 'How the notice is drawn.' },
	},
} as const satisfies WidgetConfigJsonSchema
