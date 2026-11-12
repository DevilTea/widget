import { separateWidgetSource } from '@deviltea/widget-core'
import { describe, expect, it } from 'vitest'
import { formatDiagnosticPath, formatSeparatedSourceLocation } from './diagnostic-format'

describe('formatDiagnosticPath', () => {
	it('joins string and number segments and hides an empty or missing path', () => {
		expect(formatDiagnosticPath(['slots', 'items', 0, 'config']))
			.toBe('slots.items[0].config')
		expect(formatDiagnosticPath([]))
			.toBeNull()
		expect(formatDiagnosticPath(undefined))
			.toBeNull()
	})
})

describe('formatSeparatedSourceLocation', () => {
	it('formats each representation area, with and without an index or path', () => {
		expect(formatSeparatedSourceLocation({ area: 'widgets' }))
			.toBe('widgets')
		expect(formatSeparatedSourceLocation({ area: 'widgets', index: 2, path: ['id'] }))
			.toBe('widgets[2].id')
		expect(formatSeparatedSourceLocation({ area: 'structure', path: ['slots', 'items', 1] }))
			.toBe('structure.slots.items[1]')
		expect(formatSeparatedSourceLocation({ area: 'source', path: [] }))
			.toBe('source')
		expect(formatSeparatedSourceLocation({ area: 'source', path: ['slots', 'body', 0, 'extra'] }))
			.toBe('source.slots.body[0].extra')
	})

	it('formats the location of a real source-area diagnostic from Core', () => {
		const projection = separateWidgetSource({ id: 'root', type: 'Stack', slots: { items: 'not-an-array' } })
		expect(projection.diagnostics.length)
			.toBeGreaterThan(0)
		for (const diagnostic of projection.diagnostics) {
			expect(diagnostic.location.area)
				.toBe('source')
			expect(formatSeparatedSourceLocation(diagnostic.location))
				.toMatch(/^source(?:\.|\[|$)/)
		}
	})
})
