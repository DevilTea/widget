<script setup lang="ts">
/**
 * What the host did about the widgets' Events, as a plain list: it heard `stepChanged` and moved focus, it heard
 * `slotRequested` and asked the office, the office answered, `settleBooking` applied or ignored the answer. It is the
 * page's own log and complements the Lab's Events tab, which shows the same Events from outside.
 *
 * No live region: the list is a record to read, not an announcement.
 */
import type { HostActivity } from './onboarding-host'
import { computed, inject, useId } from 'vue'
import { BUTTON_STYLE } from './control-style'
import { OnboardingHostKey } from './onboarding-host'
import { useOnboardingText } from './use-onboarding-text'

const host = inject(OnboardingHostKey, null)
const { t, tf, date } = useOnboardingText()
const headingId = useId()

const KEYS = {
	'step-changed': 'activityStepChanged',
	'slot-requested': 'activitySlotRequested',
	'office-held': 'activityOfficeHeld',
	'office-answered': 'activityOfficeAnswered',
	'answer-applied': 'activityAnswerApplied',
	'answer-ignored': 'activityAnswerIgnored',
	'answer-failed': 'activityAnswerFailed',
	'recalled': 'activityRecalled',
	'not-recalled': 'activityNotRecalled',
	'slot-released': 'activitySlotReleased',
	'welcome-queued': 'activityWelcome',
} as const

function line(entry: HostActivity): string {
	const values = { ...entry.values }
	if (typeof values.date === 'string')
		values.date = date(values.date)
	if (typeof values.status === 'string')
		values.status = values.status === 'confirmed' ? t('statusConfirmed') : t('statusDeclined')
	return tf(KEYS[entry.kind], values)
}

const lines = computed(() => (host?.activity.value ?? []).map(entry => ({ sequence: entry.sequence, kind: entry.kind, text: line(entry) })))
</script>

<template>
	<section
		v-if="host !== null"
		:aria-labelledby="headingId"
		class="activity"
		data-testid="host-activity"
		data-tutorial-target="onboarding-host-activity"
	>
		<div class="activity-header">
			<h2
				:id="headingId"
				class="activity-heading"
			>
				{{ t('activityHeading') }}
			</h2>
			<button
				v-if="lines.length > 0"
				type="button"
				class="activity-clear"
				:style="BUTTON_STYLE"
				data-testid="host-activity-clear"
				@click="host.clearActivity()"
			>
				{{ t('clearActivity') }}
			</button>
		</div>
		<p class="activity-intro">
			{{ t('activityIntro') }}
		</p>
		<ol
			v-if="lines.length > 0"
			class="activity-list"
		>
			<li
				v-for="entry in lines"
				:key="entry.sequence"
				class="activity-line"
				:data-kind="entry.kind"
				data-testid="host-activity-line"
			>
				{{ entry.text }}
			</li>
		</ol>
		<p
			v-else
			class="activity-empty"
		>
			{{ t('activityEmpty') }}
		</p>
	</section>
</template>

<style scoped>
.activity {
	display: flex;
	flex-direction: column;
	gap: 8px;
	padding: 14px 16px;
	border: 1px dashed var(--onboarding-text-muted);
	border-radius: var(--onboarding-radius);
	background: var(--onboarding-surface);
}

.activity-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
}

.activity-heading {
	margin: 0;
	font-size: 16px;
}

.activity-intro,
.activity-empty {
	margin: 0;
	font-size: 13px;
	color: var(--onboarding-text-muted);
}

.activity-list {
	display: flex;
	flex-direction: column;
	gap: 4px;
	margin: 0;
	padding-left: 22px;
	font-size: 13px;
}

.activity-clear {
	min-height: 28px;
	min-width: 56px;
	padding: 2px 10px;
	border-radius: var(--onboarding-radius);
	background: var(--onboarding-surface-alt);
	cursor: pointer;
}

.activity-clear:focus-visible {
	outline: 2px solid var(--onboarding-accent);
	outline-offset: 2px;
}
</style>
