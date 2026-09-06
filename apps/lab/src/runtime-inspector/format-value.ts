import type { InspectableValue } from '@deviltea/widget-devtools'

/** Human-readable, bounded rendering of DevTools' JSON-safe value encoding. */
export function formatInspectableValue(value: InspectableValue): string {
	switch (value.type) {
		case 'null': return 'null'
		case 'undefined': return 'undefined'
		case 'boolean': return String(value.value)
		case 'string': return `${JSON.stringify(value.value)}${value.truncated ? '…' : ''}`
		case 'number': return String(value.value)
		case 'number-special':
			return {
				'nan': 'NaN',
				'positive-infinity': 'Infinity',
				'negative-infinity': '-Infinity',
				'negative-zero': '-0',
			}[value.value]
		case 'bigint': return `${value.value}n`
		case 'array':
			return `[${value.items.map(formatInspectableValue)
				.join(', ')}${value.truncated ? ', …' : ''}]`
		case 'object':
			return `{ ${value.entries.map(entry => `${JSON.stringify(entry.key)}: ${formatInspectableValue(entry.value)}`)
				.join(', ')}${value.truncated ? ', …' : ''} }`
		case 'reference': return `<ref #${value.ref}>`
		case 'opaque': return `<${value.kind}>`
		case 'truncated': return '<truncated>'
	}
}
