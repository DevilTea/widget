import type { InspectableValue } from '@deviltea/widget-inspector/value'

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

/**
 * Whether the Inspector left anything out of this value: a container cut at its entry/node budget, a string cut
 * at its length limit, or a subtree replaced by `{ type: 'truncated' }` at the depth limit. These limits belong
 * to the Inspector snapshot (protocol), not to the Lab; the Lab only says so where it happens.
 */
export function hasTruncation(value: InspectableValue): boolean {
	switch (value.type) {
		case 'string': return value.truncated
		case 'truncated': return true
		case 'array': return value.truncated || value.items.some(hasTruncation)
		case 'object': return value.truncated || value.entries.some(entry => entry.keyTruncated === true || hasTruncation(entry.value))
		default: return false
	}
}

/** Longer than this, a string no longer reads well on one summary line and gets its own disclosure. */
const INLINE_STRING_LENGTH = 40

/** Whether a value deserves an expandable view: any container, a long or cut string. */
export function isExpandableValue(value: InspectableValue): boolean {
	switch (value.type) {
		case 'array':
		case 'object':
			return true
		case 'string':
			return value.truncated || value.value.length > INLINE_STRING_LENGTH
		default:
			return false
	}
}

/** Short one-line description of a container for a collapsed row, e.g. `Array(3)` or `Object {4}` (`+` when cut). */
export function describeContainer(value: Extract<InspectableValue, { type: 'array' | 'object' }>): string {
	const count = value.type === 'array' ? value.items.length : value.entries.length
	const more = value.truncated ? '+' : ''
	return value.type === 'array' ? `Array(${count}${more})` : `Object {${count}${more}}`
}
