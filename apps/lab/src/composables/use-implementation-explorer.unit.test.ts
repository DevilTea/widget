import { describe, expect, it } from 'vitest'
import { createImplementationExplorerStore } from './use-implementation-explorer'

describe('implementationExplorerStore', () => {
	it('defaults explicit open requests to focused mode and carries catalog intent when requested', () => {
		const store = createImplementationExplorerStore()
		expect(store.requestedMode.value)
			.toBe('focused')
		expect(store.openRequestTick.value)
			.toBe(0)

		store.open('catalog')
		expect(store.requestedMode.value)
			.toBe('catalog')
		expect(store.openRequestTick.value)
			.toBe(1)

		store.open()
		expect(store.requestedMode.value)
			.toBe('focused')
		expect(store.openRequestTick.value)
			.toBe(2)
	})
})
