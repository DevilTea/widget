/**
 * Pure unit coverage for `trip-metrics-diagnostic-provenance.ts` (diagnostic #26 Finding 3) — no Vue mounting
 * needed since the module is framework-agnostic. Diagnostic objects are constructed by hand here (rather than
 * pulled off a real Runtime) purely to pin down the attribution logic in isolation; the real
 * `property-dependency`/`property-result` shapes this exercises are proven end-to-end against a real
 * Runtime in `TripMetricsRenderer.unit.test.ts`.
 */
import type { RuntimePropertyDiagnostic } from '@deviltea/widget-core'
import { describe, expect, it } from 'vitest'
import { describeDependencyUpstream, toProvenanceLine, toProvenanceLines } from './trip-metrics-diagnostic-provenance'

function propertyResultDiagnostic(message: string): RuntimePropertyDiagnostic {
	return {
		code: 'invalid-property-result',
		location: { type: 'property', widgetId: 'trip-metrics', name: 'tripDays' },
		message,
		result: 0,
	}
}

function propertyDependencyDiagnostic(message: string, dependencyName: string): RuntimePropertyDiagnostic {
	return {
		code: 'dependency-target-failed',
		location: { type: 'property', widgetId: 'trip-metrics', name: 'budgetPerPersonPerDay' },
		message,
		dependency: { target: { type: 'self' }, operation: { type: 'property-get', name: dependencyName } },
		related: [{ type: 'property', widgetId: 'trip-metrics', name: dependencyName }],
		cause: propertyResultDiagnostic('upstream failed'),
	}
}

describe('describeDependencyUpstream', () => {
	it('resolves a self-targeted property-get dependency on a known TripMetrics sibling to its human label', () => {
		expect(describeDependencyUpstream({ target: { type: 'self' }, operation: { type: 'property-get', name: 'tripDays' } }))
			.toBe('Trip days')
		expect(describeDependencyUpstream({ target: { type: 'self' }, operation: { type: 'property-get', name: 'estimatedBaselineCost' } }))
			.toBe('Estimated baseline cost')
	})

	it('falls back to formatDependencyReference() for anything it does not recognize as a sibling TripMetrics property', () => {
		expect(describeDependencyUpstream({ target: { type: 'widget', widgetId: 'departure', optional: false }, operation: { type: 'state-get', key: 'answer' } }))
			.toBe('widget("departure") -> state.get("answer")')
		expect(describeDependencyUpstream({ target: { type: 'self' }, operation: { type: 'property-get', name: 'notAKnownMetric' } }))
			.toBe('self -> properties.get("notAKnownMetric")')
	})
})

describe('toProvenanceLine / toProvenanceLines', () => {
	it('renders a property-result diagnostic verbatim as the owning metric\'s own root cause', () => {
		const diagnostic = propertyResultDiagnostic('Return date must be strictly after the departure date.')
		expect(toProvenanceLine(diagnostic, 0).text)
			.toBe('Return date must be strictly after the departure date.')
	})

	it('renders a property-dependency diagnostic as an attributed line, not the wrapped root-cause message', () => {
		const diagnostic = propertyDependencyDiagnostic('Return date must be strictly after the departure date.', 'tripDays')
		expect(toProvenanceLine(diagnostic, 0).text)
			.toBe('Unavailable because Trip days failed.')
	})

	it('maps a mixed diagnostic list to lines in order without deduping', () => {
		const diagnostics: readonly RuntimePropertyDiagnostic[] = [
			propertyDependencyDiagnostic('Return date must be strictly after the departure date.', 'tripDays'),
			propertyDependencyDiagnostic('Return date must be strictly after the departure date.', 'tripDays'),
		]
		const lines = toProvenanceLines(diagnostics)
		expect(lines)
			.toHaveLength(2)
		expect(lines.every(line => line.text === 'Unavailable because Trip days failed.'))
			.toBe(true)
		// Distinct keys even for textually-identical lines, so `v-for` never collides.
		expect(new Set(lines.map(line => line.key)).size)
			.toBe(2)
	})
})
