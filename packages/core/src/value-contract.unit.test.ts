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

	it('attaches a shared contract to a Property whose value type is the same or narrower', () => {
		interface Interfaces {
			properties: {
				size: 'small' | 'large'
				fixed: 'fixed'
				text: string
			}
		}

		const plugin = createWidgetPlugin('value-contract-narrower')
			.description('Value-contract narrowing fixture')
			.interfaces<Interfaces>()
			.properties(properties => properties
				.size({ valueContract: stringContract, compute: () => 'small' as const })
				.fixed({ valueContract: stringContract, compute: () => 'fixed' as const })
				.text({ valueContract: stringContract, compute: () => 'text' }))
			.done()

		expectTypeOf<WidgetValueContract<string>>()
			.toExtend<WidgetValueContract<'small' | 'large'>>()
		expect(plugin.type)
			.toBe('value-contract-narrower')
	})

	it('rejects a contract for a Property whose value type is wider or unrelated', () => {
		interface Interfaces {
			properties: {
				label: string | null
				text: string
				size: 'small' | 'large'
			}
		}
		const smallContract = createWidgetValueContract<'small'>('example/small')

		createWidgetPlugin('value-contract-wider')
			.description('Value-contract widening fixture')
			.interfaces<Interfaces>()
			.properties(properties => properties
				.label({
					// @ts-expect-error a `string | null` Property can produce `null`, which a string contract does not describe
					valueContract: stringContract,
					compute: () => null,
				})
				.text({
					// @ts-expect-error a `string` Property is wider than a `'small'` contract
					valueContract: smallContract,
					compute: () => 'text',
				})
				.size({
					// @ts-expect-error `'small' | 'large'` is wider than a `'small'` contract
					valueContract: smallContract,
					compute: () => 'small' as const,
				}))
			.done()

		expectTypeOf<WidgetValueContract<'small'>>()
			.not
			.toExtend<WidgetValueContract<string>>()
		expect(smallContract.id)
			.toBe('example/small')
	})
})
