/**
 * Pure, framework-agnostic provenance-line helpers for `TripMetricsRenderer.vue` (issue #26 Finding 3):
 * turns a `RuntimePropertyIssue[]` for one `TripMetrics` Property into human-readable lines, grouped by
 * the Property that owns them — never by parsing `issue.message`, and never by de-duplicating messages
 * across Properties. Every field beyond `message` is read from `issue.source`'s machine-readable
 * structure, matching the convention `src/lib/issue-format.ts` documents.
 *
 * Extracted out of the renderer so the attribution logic (which line wins, which upstream label a
 * `property-dependency` issue resolves to) is unit-testable without mounting a Vue component.
 *
 * The "flattened-and-therefore-look-like-duplicates" defect this fixes: `tripDays` failing cascades
 * into `property-dependency` issues on `budgetPerPersonPerDay`/`estimatedBaselineCost` that wrap
 * `tripDays`'s own message 1:1 (issue #10 §12). Rendered as one flat list, the same sentence appears
 * three times with no indication that two of those three are consequences, not distinct root causes.
 * Grouping each Property's issues under its own label already fixes *that*; rewriting a
 * `property-dependency` line as "Unavailable because <upstream> failed" (rather than repeating the
 * wrapped message verbatim) is what then makes the two downstream rows read as attributed consequences
 * instead of the same error occurring three times over.
 */

import type { BlueprintDependencyReference, RuntimePropertyIssue } from '@deviltea/widget-core'
import { formatDependencyReference } from '../../../lib/issue-format'

/**
 * Human labels for this showcase's own `TripMetrics` properties — the only sibling Properties a
 * `property-dependency` issue on another `TripMetrics` Property can point back at today
 * (`budgetPerPersonPerDay`/`estimatedBaselineCost` both read `tripDays` via `dep.self.properties.get(...)`;
 * see `../plugins/trip-metrics.ts`). Keys are `BlueprintDependencyOperation['name']` values, not display
 * strings, so they line up 1:1 with `usePropertyIssues()`'s own keys in the renderer.
 */
export const TRIP_METRICS_PROPERTY_LABELS: Readonly<Record<string, string>> = {
	tripDays: 'Trip days',
	travelerCount: 'Travelers',
	budgetPerPersonPerDay: 'Budget / person / day',
	estimatedBaselineCost: 'Estimated baseline cost',
}

/**
 * Resolves the human label for a dependency's upstream target when it is a self-targeted read of a
 * sibling `TripMetrics` Property this renderer already labels (`TRIP_METRICS_PROPERTY_LABELS`);
 * otherwise falls back to the generic structural description (`formatDependencyReference()`) rather
 * than guessing.
 */
export function describeDependencyUpstream(dependency: BlueprintDependencyReference): string {
	if (dependency.target.type === 'self' && dependency.operation.type === 'property-get') {
		const label = TRIP_METRICS_PROPERTY_LABELS[dependency.operation.name]
		if (label !== undefined)
			return label
	}
	return formatDependencyReference(dependency)
}

export interface IssueProvenanceLine {
	/** Stable per-render key (`v-for` `:key`) — index-based since `RuntimePropertyIssue` carries no id. */
	readonly key: string
	readonly text: string
}

/**
 * One issue -> one presented line: a `property-result` issue (this Property's own root cause) renders
 * its `message` verbatim; a `property-dependency` issue (caused by reading a failed sibling/cross-widget
 * dependency) renders as an attributed "Unavailable because <upstream> failed." line instead of
 * repeating the wrapped target message.
 */
export function toProvenanceLine(issue: RuntimePropertyIssue, index: number): IssueProvenanceLine {
	if (issue.source.type === 'property-dependency') {
		return {
			key: `dependency-${index}`,
			text: `Unavailable because ${describeDependencyUpstream(issue.source.dependency)} failed.`,
		}
	}
	return { key: `own-${index}`, text: issue.message }
}

/** Maps a Property's own `RuntimePropertyIssue[]` to its presented provenance lines, in order. */
export function toProvenanceLines(issues: readonly RuntimePropertyIssue[]): readonly IssueProvenanceLine[] {
	return issues.map((issue, index) => toProvenanceLine(issue, index))
}
