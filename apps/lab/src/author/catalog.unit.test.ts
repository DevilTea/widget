import { describe, expect, it } from 'vitest'
import { sandboxSystem } from '../sandbox/system'
import { createAuthorCatalogViewModel } from './catalog'

describe('author catalog view-model', () => {
	it('preserves Core system.catalog as its source and does not use the curated Implementation registry', () => {
		const viewModel = createAuthorCatalogViewModel(sandboxSystem)

		expect(viewModel.catalog)
			.toBe(sandboxSystem.catalog)
		expect(viewModel.widgets[0]?.entry)
			.toBe(sandboxSystem.catalog.widgets[0])
		expect(viewModel.widgets.map(widget => widget.entry.type))
			.toEqual(sandboxSystem.catalog.widgets.map(widget => widget.type))
		expect(viewModel.widgets[0]?.entry.description)
			.toBe(sandboxSystem.catalog.widgets[0]?.description)
	})
})
