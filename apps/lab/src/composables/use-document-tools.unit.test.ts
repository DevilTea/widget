import { describe, expect, it } from 'vitest'
import { createDocumentToolsStore } from './use-document-tools'

describe('documentToolsStore', () => {
	it('emits open requests without owning panel or Document state', () => {
		const store = createDocumentToolsStore()

		expect(store.openRequestTick.value)
			.toBe(0)
		store.open()
		expect(store.openRequestTick.value)
			.toBe(1)
		store.open()
		expect(store.openRequestTick.value)
			.toBe(2)
	})
})
