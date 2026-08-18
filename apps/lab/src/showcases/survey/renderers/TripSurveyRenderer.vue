<script setup lang="ts">
/**
 * Renders the `form` slot and Reset/Submit/Generate-result workflow by calling semantic Methods
 * directly. `phase`/`result` are semantic State, `resultFresh` is the semantic Property; Vue only
 * presents those facts and never duplicates their business rules. Method/core issue messages and every
 * value inside the stored result snapshot remain verbatim under #43; only renderer-owned headings,
 * actions, freshness explanation, and field labels are localized.
 */
import { useWidget } from '@deviltea/widget-vue'
import { useInspectAnchor } from '../../../composables/use-inspect-anchor'
import { useLabI18n } from '../../../composables/use-lab-i18n'
import { TripSurveyPlugin } from '../plugins/trip-survey'

const { useState, useProperties, useMethods, useMethodIssues, WidgetSlot, widgetId, widgetType } = useWidget(TripSurveyPlugin)
const { phase, result } = useState()
const { resultFresh } = useProperties()
const { reset, submit, generateResult } = useMethods()
const { submit: submitIssues, generateResult: generateResultIssues } = useMethodIssues()
const i18n = useLabI18n()
const inspectAnchor = useInspectAnchor(widgetId, widgetType)

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
	<div
		v-bind="inspectAnchor"
		:class="pika({ display: 'flex', flexDirection: 'column', gap: '12px' })"
	>
		<header :class="pika({ display: 'flex', alignItems: 'center', gap: '10px' })">
			<strong :class="pika({ fontSize: '14px' })">{{ i18n.t('Interactive Survey — trip planner') }}</strong>
			<span :class="pika({ fontSize: '11px', color: 'var(--lab-color-text-muted)' })">{{ i18n.t('phase') }}: {{ phase }}</span>
		</header>

		<WidgetSlot name="form" />

		<div
			data-tutorial-target="survey-actions"
			:class="pika({ display: 'flex', gap: '8px' })"
		>
			<button
				type="button"
				:class="pika({ padding: '6px 12px', fontSize: '12px', borderRadius: 'var(--lab-radius)', border: '1px solid var(--lab-color-border)', background: 'var(--lab-color-surface-alt)', color: 'var(--lab-color-text)', cursor: 'pointer' })"
				@click="onReset"
			>
				{{ i18n.t('Reset') }}
			</button>
			<button
				type="button"
				:class="pika({ padding: '6px 12px', fontSize: '12px', borderRadius: 'var(--lab-radius)', border: '1px solid var(--lab-color-accent)', background: 'var(--lab-color-accent)', color: 'var(--lab-color-accent-contrast)', cursor: 'pointer' })"
				@click="onSubmit"
			>
				{{ i18n.t('Submit') }}
			</button>
			<button
				type="button"
				:class="pika({ padding: '6px 12px', fontSize: '12px', borderRadius: 'var(--lab-radius)', border: '1px solid var(--lab-color-border)', background: 'var(--lab-color-surface-alt)', color: 'var(--lab-color-text)', cursor: 'pointer' })"
				@click="onGenerateResult"
			>
				{{ i18n.t('Generate result') }}
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
			data-tutorial-target="survey-recommendation"
			:class="pika({ padding: '10px 12px', borderRadius: 'var(--lab-radius)', background: 'var(--lab-color-surface)' })"
			:style="{ border: `1px solid ${resultFresh ? 'var(--lab-color-accent)' : 'var(--lab-color-warning)'}` }"
		>
			<h3 :class="pika({ margin: '0 0 6px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' })">
				{{ i18n.t('Recommendation') }}
				<span
					v-if="!resultFresh"
					:class="pika({ fontSize: '10px', fontWeight: 'normal', padding: '1px 6px', borderRadius: '999px', background: 'var(--lab-color-surface-alt)', color: 'var(--lab-color-warning)' })"
				>
					{{ i18n.t('Stale') }}
				</span>
			</h3>
			<p
				v-if="!resultFresh"
				:class="pika({ margin: '0 0 8px', fontSize: '11px', color: 'var(--lab-color-warning)' })"
			>
				{{ i18n.t('Generated from previous answers — this recommendation does not reflect the current answers (or any issues shown above). Submit and generate again to refresh it.') }}
			</p>
			<p :class="pika({ margin: '0 0 4px', fontSize: '12px' })">
				{{ i18n.t('Destination') }}: <strong>{{ result.destination }}</strong> · {{ i18n.t('requested style') }}: {{ result.requestedStyle }} · {{ i18n.t('recommended style') }}: <strong>{{ result.recommendedStyle }}</strong> · {{ i18n.t('fit') }}: {{ result.fit }}
			</p>
			<p :class="pika({ margin: '0 0 4px', fontSize: '12px' })">
				{{ i18n.t('Trip days') }}: {{ result.tripDays }} · {{ i18n.t('travelers') }}: {{ result.travelers }}
			</p>
			<p :class="pika({ margin: '0 0 4px', fontSize: '12px' })">
				{{ i18n.t('Budget') }}: {{ result.budget }} {{ i18n.t('vs. estimated baseline cost') }}: {{ result.estimatedBaselineCost.toFixed(2) }} ({{ i18n.t('gap') }} {{ result.budgetGap.toFixed(2) }}) · {{ i18n.t('budget/person/day') }}: {{ result.budgetPerPersonPerDay.toFixed(2) }}
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
