<script setup lang="ts">
/**
 * The simulated booking office, as the host sees it: two switches that are the host's own settings (not widget State:
 * the office is outside Core) and the requests that have been sent to it and not answered yet. "Hold" keeps the
 * office from answering until the visitor lets it, so a request can be looked at while it waits; "recall" says whether a
 * cancelled request can still be called back, and when it cannot its answer arrives later and the ticket guard of
 * `settleBooking` ignores it.
 */
import { inject, useId } from 'vue'
import { BUTTON_STYLE } from './control-style'
import { OnboardingHostKey } from './onboarding-host'
import { useOnboardingText } from './use-onboarding-text'

const host = inject(OnboardingHostKey, null)
const { t, tf, date } = useOnboardingText()
const headingId = useId()
const holdId = useId()
const recallId = useId()
</script>

<template>
	<section
		v-if="host !== null"
		:aria-labelledby="headingId"
		class="office"
		data-testid="office-desk"
		data-tutorial-target="onboarding-office"
	>
		<h3
			:id="headingId"
			class="office-heading"
		>
			{{ t('officeHeading') }}
		</h3>
		<p class="office-intro">
			{{ t('officeIntro') }}
		</p>
		<div class="office-switch">
			<input
				:id="holdId"
				v-model="host.hold.value"
				type="checkbox"
				class="office-box"
				data-testid="office-hold"
			>
			<label
				:for="holdId"
				class="office-label"
			>{{ t('officeHold') }}</label>
		</div>
		<div class="office-switch">
			<input
				:id="recallId"
				v-model="host.recall.value"
				type="checkbox"
				class="office-box"
				data-testid="office-recall"
			>
			<label
				:for="recallId"
				class="office-label"
			>{{ t('officeRecall') }}</label>
		</div>
		<ul
			v-if="host.pending.value.length > 0"
			class="office-pending"
		>
			<li
				v-for="request in host.pending.value"
				:key="request.ticket"
				class="office-request"
				data-testid="office-request"
				:data-phase="request.phase"
			>
				<span class="office-request-text">
					{{ tf('officePending', { ticket: request.ticket, date: date(request.date), time: request.time }) }}
					({{ request.orphaned ? t('officeOrphaned') : request.phase === 'held' ? t('officeHeld') : t('officeWaiting') }})
				</span>
				<button
					type="button"
					class="office-answer"
					:style="BUTTON_STYLE"
					data-testid="office-answer-now"
					@click="host.answerNow(request.ticket)"
				>
					{{ tf('officeAnswerNow', { ticket: request.ticket }) }}
				</button>
			</li>
		</ul>
		<p
			v-else
			class="office-none"
		>
			{{ t('officeNoPending') }}
		</p>
	</section>
</template>

<style scoped>
.office {
	display: flex;
	flex-direction: column;
	gap: 8px;
	padding: 12px 14px;
	border: 1px dashed var(--onboarding-text-muted);
	border-radius: var(--onboarding-radius);
}

.office-heading {
	margin: 0;
	font-size: 15px;
}

.office-intro,
.office-none {
	margin: 0;
	font-size: 13px;
	color: var(--onboarding-text-muted);
}

.office-switch {
	display: flex;
	align-items: center;
	gap: 8px;
	min-height: 28px;
	font-size: 14px;
}

.office-label {
	display: inline-flex;
	align-items: center;
	min-height: 28px;
}

.office-box {
	width: 18px;
	height: 18px;
	margin: 0;
	accent-color: var(--onboarding-accent);
}

.office-box:focus-visible,
.office-answer:focus-visible {
	outline: 2px solid var(--onboarding-accent);
	outline-offset: 2px;
}

.office-pending {
	display: flex;
	flex-direction: column;
	gap: 6px;
	margin: 0;
	padding: 0;
	list-style: none;
}

.office-request {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
	font-size: 14px;
}

.office-answer {
	min-height: 28px;
	padding: 2px 10px;
	border-radius: var(--onboarding-radius);
	background: var(--onboarding-surface-alt);
	cursor: pointer;
}
</style>
