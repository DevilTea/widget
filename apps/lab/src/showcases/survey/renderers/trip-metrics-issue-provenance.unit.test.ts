/**
 * Pure unit coverage for `trip-metrics-issue-provenance.ts` (issue #26 Finding 3) — no Vue mounting
 * needed since the module is framework-agnostic. Issue objects are constructed by hand here (rather than
 * pulled off a real Runtime) purely to pin down the attribution logic in isolation; the real
 * `property-dependency`/`property-result` shapes this exercises are proven end-to-end against a real
 * Runtime in `TripMetricsRenderer.unit.test.ts`.
 */
import type { RuntimePropertyIssue } from '@deviltea/widget-core'
import { describe, expect, it } from 'vitest'
import { describeDependencyUpstream, toProvenanceLine, toProvenanceLines } from './trip-metrics-issue-provenance'

function propertyResultIssue(message: string): RuntimePropertyIssue {
	return {
		message,
		source: { type: 'property-result', widgetId: 'trip-metrics', name: 'tripDays', result: 0 },
	}
}

function propertyDependencyIssue(message: string, dependencyName: string): RuntimePropertyIssue {
	return {
		message,
		source: {
			type: 'property-dependency',
			widgetId: 'trip-metrics',
			name: 'budgetPerPersonPerDay',
			dependency: { target: { type: 'self' }, operation: { type: 'property-get', name: dependencyName } },
		},
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
	it('renders a property-result issue verbatim as the owning metric\'s own root cause', () => {
		const issue = propertyResultIssue('Return date must be strictly after the departure date.')
		expect(toProvenanceLine(issue, 0).text)
			.toBe('Return date must be strictly after the departure date.')
	})

	it('renders a property-dependency issue as an attributed line, not the wrapped root-cause message', () => {
		const issue = propertyDependencyIssue('Return date must be strictly after the departure date.', 'tripDays')
		expect(toProvenanceLine(issue, 0).text)
			.toBe('Unavailable because Trip days failed.')
	})

	it('maps a mixed issue list to lines in order without deduping', () => {
		const issues: readonly RuntimePropertyIssue[] = [
			propertyDependencyIssue('Return date must be strictly after the departure date.', 'tripDays'),
			propertyDependencyIssue('Return date must be strictly after the departure date.', 'tripDays'),
		]
		const lines = toProvenanceLines(issues)
		expect(lines)
			.toHaveLength(2)
		expect(lines.every(line => line.text === 'Unavailable because Trip days failed.'))
			.toBe(true)
		// Distinct keys even for textually-identical lines, so `v-for` never collides.
		expect(new Set(lines.map(line => line.key)).size)
			.toBe(2)
	})
})
