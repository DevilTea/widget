/**
 * Registry-shape sanity (diagnostic #25 P3 Scope F) for all three curated `sources.ts` modules: every
 * type each registry curates must be a real plugin type on its showcase's `WidgetSystem` — a
 * typo'd/renamed/removed plugin type would otherwise silently curate a dead entry the Implementation
 * panel can never reach.
 */

import type { AnyWidgetPluginTuple, WidgetSystem } from '@deviltea/widget-core'
import type { SourcesRegistry } from './types'
import { describe, expect, it } from 'vitest'
import { sandboxSources } from '../sandbox/sources'
import { sandboxSystem } from '../sandbox/system'
import { crmSources } from '../showcases/crm/sources'
import { crmSystem } from '../showcases/crm/system'
import { surveySources } from '../showcases/survey/sources'
import { surveySystem } from '../showcases/survey/system'
import { findDanglingRegistryTypes, findUncuratedPluginTypes } from './registry-coverage'

const showcases: readonly { readonly label: string, readonly system: WidgetSystem<AnyWidgetPluginTuple>, readonly sources: SourcesRegistry }[] = [
	{ label: 'sandbox', system: sandboxSystem as unknown as WidgetSystem<AnyWidgetPluginTuple>, sources: sandboxSources },
	{ label: 'survey', system: surveySystem as unknown as WidgetSystem<AnyWidgetPluginTuple>, sources: surveySources },
	{ label: 'crm', system: crmSystem as unknown as WidgetSystem<AnyWidgetPluginTuple>, sources: crmSources },
]

describe('curated sources registries', () => {
	it.each(showcases)('$label: every curated type is a real plugin type (no dangling entries)', ({ system, sources }) => {
		expect(findDanglingRegistryTypes(sources, system))
			.toEqual([])
	})

	// Full coverage is a deliberate curation choice (diagnostic #25 Scope C: "Domain helper entries only
	// where directly relevant"), not a structural requirement — but for these three showcases every
	// registered plugin type IS curated, so this pins that intentional choice rather than letting a
	// newly-added plugin silently go uncurated without anyone noticing.
	it.each(showcases)('$label: every registered plugin type is curated', ({ system, sources }) => {
		expect(findUncuratedPluginTypes(sources, system))
			.toEqual([])
	})

	it.each(showcases)('$label: every curated file entry has a non-empty title/path and a callable load()', ({ sources }) => {
		for (const entry of Object.values(sources)) {
			expect(entry.files.length)
				.toBeGreaterThan(0)
			for (const file of entry.files) {
				expect(file.title.length)
					.toBeGreaterThan(0)
				expect(file.path.length)
					.toBeGreaterThan(0)
				expect(typeof file.load)
					.toBe('function')
			}
		}
	})

	it('sandbox/survey/crm curated file loaders resolve to non-empty raw source text', async () => {
		for (const { sources } of showcases) {
			for (const entry of Object.values(sources)) {
				for (const file of entry.files) {
					const text = await file.load()
					expect(typeof text)
						.toBe('string')
					expect(text.length)
						.toBeGreaterThan(0)
				}
			}
		}
	})
})
