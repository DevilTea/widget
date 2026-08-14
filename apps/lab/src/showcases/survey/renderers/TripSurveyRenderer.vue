<script setup lang="ts">
/**
 * Renders the `form` slot, the Reset/Submit/Generate result workflow (calling the semantic Methods
 * directly through `useMethods()`), and `phase`/`result` from `useState()`. Deliberately does **not**
 * render the `semantics` slot (checkpoint §2/§6) — `TripReadiness`/`TripRecommendation` stay in the
 * semantic topology only. Method failures (readiness/recommendation dependency propagation) surface
 * through `useMethodIssues()` — this component never re-validates before calling a Method (checkpoint
 * §4: "Vue must call semantic Methods directly ... must not duplicate these validation decisions").
 */
import { useWidget } from '@deviltea/widget-vue'
import { TripSurveyPlugin } from '../plugins/trip-survey'

const { useState, useMethods, useMethodIssues, WidgetSlot } = useWidget(TripSurveyPlugin)
const { phase, result } = useState()
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
				:disabled="phase === 'editing'"
				:class="pika({ 'padding': '6px 12px', 'fontSize': '12px', 'borderRadius': 'var(--lab-radius)', 'border': '1px solid var(--lab-color-border)', 'background': 'var(--lab-color-surface-alt)', 'color': 'var(--lab-color-text)', 'cursor': 'pointer', '$:disabled': { opacity: '0.5', cursor: 'not-allowed' } })"
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
			:class="pika({ padding: '10px 12px', border: '1px solid var(--lab-color-accent)', borderRadius: 'var(--lab-radius)', background: 'var(--lab-color-surface)' })"
		>
			<h3 :class="pika({ margin: '0 0 6px', fontSize: '13px' })">
				Recommendation
			</h3>
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
