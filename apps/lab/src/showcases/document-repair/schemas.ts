/**
 * Draft 2020-12 JSON Schemas for the repair desk plugins' configs. They are passive authoring metadata (`config.schema`):
 * Core never validates against them, and the Catalog and the Structure editor show them. They state shape only; the config
 * checkers (`./config.ts`) enforce the rest and report it as located diagnostics. `SavedDraft.source` has no `type` on purpose:
 * it is any JSON value, the stored legacy document, and whether it is a valid notice board is what the inner system says.
 *
 * A unit test pins that each schema's top-level `properties` equal the key lists of `./config.ts`.
 */

import type { WidgetConfigJsonSchema } from '@deviltea/widget-core'
import { WIDGET_CONFIG_JSON_SCHEMA_DIALECT } from '@deviltea/widget-core'
import { SAVED_WITH_VERSIONS } from './domain'

export const repairDeskConfigSchema = {
	$schema: WIDGET_CONFIG_JSON_SCHEMA_DIALECT,
	type: 'object',
	additionalProperties: false,
	required: ['appVersion'],
	properties: {
		appVersion: { type: 'string', pattern: '^\\d+\\.\\d+$', description: 'The notice-board app version that opens the drafts, such as "3.0". It writes format 3.x.' },
	},
} as const satisfies WidgetConfigJsonSchema

export const savedDraftConfigSchema = {
	$schema: WIDGET_CONFIG_JSON_SCHEMA_DIALECT,
	type: 'object',
	additionalProperties: false,
	required: ['title', 'savedWith', 'source'],
	properties: {
		title: { type: 'string', minLength: 1, description: 'What the draft is called in the app\'s draft list.' },
		savedWith: { type: 'string', enum: [...SAVED_WITH_VERSIONS], description: 'The format version of the app that saved the draft. The migration plan is chosen by it; Core does not know it.' },
		source: { description: 'The stored legacy document: any JSON value, kept exactly as saved. The widget compiles it with the notice board system and never changes it.' },
	},
} as const satisfies WidgetConfigJsonSchema
