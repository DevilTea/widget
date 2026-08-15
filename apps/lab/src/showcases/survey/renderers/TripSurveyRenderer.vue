<script setup lang="ts">
/**
 * Renders the `form` slot, the Reset/Submit/Generate result workflow (calling the semantic Methods
 * directly through `useMethods()`), and `phase`/`result` from `useState()`. Deliberately does **not**
 * render the `semantics` slot (checkpoint §2/§6) — `TripReadiness`/`TripRecommendation` stay in the
 * semantic topology only. Method failures (readiness/recommendation dependency propagation) surface
 * through `useMethodIssues()` — this component never re-validates before calling a Method (checkpoint
 * §4: "Vue must call semantic Methods directly ... must not duplicate these validation decisions").
 * In particular, "Generate result" is never disabled on `phase !== 'submitted'`: that precondition is
 * `generateResult()`'s own Method rule (checkpoint §5), and gating the button here would duplicate that
 * business rule in Vue and suppress the `method-result` failure path the checkpoint intends to be
 * exercisable — the button stays clickable in every phase; the Method alone decides success/failure.
 *
 * Issue #26 Finding 1/4: whether the retained `result` snapshot is still trustworthy is the semantic
 * `resultFresh` Property (`../plugins/trip-survey.ts`), read here through `useProperties()` — this
 * component only presents that fact, it never recomputes or compares answers itself. Method-issue
 * copy (Finding 4) is left as plain `issue.message` text intentionally: `submit`/`generateResult`
 * dependency failures already wrap their target Property's own per-requirement message 1:1 (e.g.
 * "Departure date is required."), which is already specific and actionable — rewriting it through the
 * same "Unavailable because X failed" provenance phrasing used by `TripMetricsRenderer` (Finding 3)
 * would only discard that detail for a generic mechanical description, since (unlike TripMetrics'
 * sibling-metric duplication) there is no multi-row duplicate-appearance problem to solve here.
 */
import { useWidget } from '@deviltea/widget-vue'
import { TripSurveyPlugin } from '../plugins/trip-survey'

const { useState, useProperties, useMethods, useMethodIssues, WidgetSlot } = useWidget(TripSurveyPlugin)
const { phase, result } = useState()
const { resultFresh } = useProperties()
const { reset, submit, generateResult } = useMethods()
const methodIssues = useMethodIssues()
const { submit: submitIssues, generateResult: generateResultIssues } = methodIssues

function onReset(): void {
	reset()
}
function onSubmit(): void {
	submit()
}
function onGenerateResult(): void {
	generateResult()
}
</script>

<template>
	<div :class="pika({ display: 'flex', flexDirection: 'column', gap: '12px' })">
		<header :class="pika({ display: 'flex', alignItems: 'center', gap: '10px' })">
			<strong :class="pika({ fontSize: '14px' })">Interactive Survey — trip planner</strong>
			<span :class="pika({ fontSize: '11px', color: 'var(--lab-color-text-muted)' })">phase: {{ phase }}</span>
		</header>

		<WidgetSlot name="form" />

		<div :class="pika({ display: 'flex', gap: '8px' })">
			<button
				type="button"
				:class="pika({ padding: '6px 12px', fontSize: '12px', borderRadius: 'var(--lab-radius)', border: '1px solid var(--lab-color-border)', background: 'var(--lab-color-surface-alt)', color: 'var(--lab-color-text)', cursor: 'pointer' })"
				@click="onReset"
			>
				Reset
			</button>
			<button
				type="button"
				:class="pika({ padding: '6px 12px', fontSize: '12px', borderRadius: 'var(--lab-radius)', border: '1px solid var(--lab-color-accent)', background: 'var(--lab-color-accent)', color: 'var(--lab-color-accent-contrast)', cursor: 'pointer' })"
				@click="onSubmit"
			>
				Submit
			</button>
			<button
				type="button"
				:class="pika({ padding: '6px 12px', fontSize: '12px', borderRadius: 'var(--lab-radius)', border: '1px solid var(--lab-color-border)', background: 'var(--lab-color-surface-alt)', color: 'var(--lab-color-text)', cursor: 'pointer' })"
				@click="onGenerateResult"
			>
				Generate result
			</button>
		</div>

		<ul
			v-if="submitIssues.length > 0 || generateResultIssues.length > 0"
			:class="pika({ margin: '0', paddingLeft: '16px' })"
		>
			<li
				v-for="issue in [...submitIssues, ...generateResultIssues]"
				:key="issue.message"
				:class="pika({ fontSize: '11px', color: 'var(--lab-color-danger)' })"
			>
				{{ issue.message }}
			</li>
		</ul>

		<section
			v-if="result"
			:class="pika({ padding: '10px 12px', borderRadius: 'var(--lab-radius)', background: 'var(--lab-color-surface)' })"
			:style="{ border: `1px solid ${resultFresh ? 'var(--lab-color-accent)' : 'var(--lab-color-warning)'}` }"
		>
			<h3 :class="pika({ margin: '0 0 6px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' })">
				Recommendation
				<span
					v-if="!resultFresh"
					:class="pika({ fontSize: '10px', fontWeight: 'normal', padding: '1px 6px', borderRadius: '999px', background: 'var(--lab-color-surface-alt)', color: 'var(--lab-color-warning)' })"
				>
					Stale
				</span>
			</h3>
			<p
				v-if="!resultFresh"
				:class="pika({ margin: '0 0 8px', fontSize: '11px', color: 'var(--lab-color-warning)' })"
			>
				Generated from previous answers — this recommendation does not reflect the current answers
				(or any issues shown above). Submit and generate again to refresh it.
			</p>
			<p :class="pika({ margin: '0 0 4px', fontSize: '12px' })">
				Destination: <strong>{{ result.destination }}</strong> · requested style: {{ result.requestedStyle }} · recommended style: <strong>{{ result.recommendedStyle }}</strong> · fit: {{ result.fit }}
			</p>
			<p :class="pika({ margin: '0 0 4px', fontSize: '12px' })">
				Trip days: {{ result.tripDays }} · travelers: {{ result.travelers }}
			</p>
			<p :class="pika({ margin: '0 0 4px', fontSize: '12px' })">
				Budget: {{ result.budget }} vs. estimated baseline cost: {{ result.estimatedBaselineCost.toFixed(2) }} (gap {{ result.budgetGap.toFixed(2) }}) · budget/person/day: {{ result.budgetPerPersonPerDay.toFixed(2) }}
			</p>
			<ul
				v-if="result.notes.length > 0"
				:class="pika({ margin: '4px 0 0', paddingLeft: '16px' })"
			>
				<li
					v-for="note in result.notes"
					:key="note"
					:class="pika({ fontSize: '12px' })"
				>
					{{ note }}
				</li>
			</ul>
		</section>
	</div>
</template>
