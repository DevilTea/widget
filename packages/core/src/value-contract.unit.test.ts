import type { WidgetValueContract } from './index'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { createWidgetPlugin, createWidgetValueContract } from './index'

interface TranslationResult {
	readonly value: string
	readonly warnings: readonly string[]
}

const stringContract = createWidgetValueContract<string>('example/string')
const translationResultContract = createWidgetValueContract<TranslationResult>('example/translation-result')

describe('widget value contracts', () => {
	it('creates a frozen typed descriptor whose semantic identity is its stable string id', () => {
		expect(stringContract)
			.toEqual({ id: 'example/string' })
		expect(Object.isFrozen(stringContract))
			.toBe(true)
		expectTypeOf(stringContract)
			.toMatchTypeOf<WidgetValueContract<string>>()

		// @ts-expect-error Value contracts are factory-created typed descriptors, not forgeable plain objects.
		const forged: WidgetValueContract<string> = { id: 'example/string' }
		expect(forged.id)
			.toBe('example/string')
	})

	it('keeps the descriptor generic tied to the declared Property value type', () => {
		interface Interfaces {
			properties: {
				text: string
				result: TranslationResult
			}
		}

		createWidgetPlugin('value-contract-types')
			.description('Value-contract type fixture')
			.interfaces<Interfaces>()
			.properties(properties => properties
				.text({
					valueContract: stringContract,
					compute: () => 'text',
				})
				.result({
					valueContract: translationResultContract,
					compute: () => ({ value: 'translated', warnings: [] }),
				}))
			.done()

		createWidgetPlugin('value-contract-type-mismatch')
			.description('Value-contract mismatch fixture')
			.interfaces<Interfaces>()
			.properties(properties => properties
				.text({
					// @ts-expect-error TranslationResult contract cannot describe a string Property.
					valueContract: translationResultContract,
					compute: () => 'text',
				})
				.result({
					valueContract: translationResultContract,
					compute: () => ({ value: 'translated', warnings: [] }),
				}))
			.done()
	})
})
