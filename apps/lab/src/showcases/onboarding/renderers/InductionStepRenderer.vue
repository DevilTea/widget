<script setup lang="ts">
/**
 * Presentation only: a date box and a start-time list, "Request this slot", the booking status and Cancel.
 *
 * Reads State `status`, `slot`, `ticket`, `reference` and `reason`, and Properties `title`, `offered` and `missing`.
 * Calls Methods `requestSlot(date, time)` and `cancelBooking()`. The page does not validate the date: whatever is in the
 * box goes to `requestSlot`, whose `validateArgs` checks it against the config, and a refusal is the Method's diagnostic,
 * shown by the one alert of the page (`./problem-board.ts`). The request button stays enabled while a request waits so
 * the Method's own "a request is still waiting" refusal can be seen.
 *
 * Nothing in this step waits for the booking office. The widget only records the request and emits `slotRequested`;
 * the host (`./onboarding-host.ts`) asks the office and writes the answer back, and `OfficeDesk.vue` shows the office.
 */
import { useWidget } from '@deviltea/widget-vue'
import { computed, ref, useId } from 'vue'
import { useInspectAnchor } from '../../../showcase-host'
import { InductionStepPlugin } from '../plugins/induction-step'
import { BUTTON_STYLE, FIELD_STYLE, PRIMARY_BUTTON_STYLE } from './control-style'
import OfficeDesk from './OfficeDesk.vue'
import { reportCall, useProblemBoard } from './problem-board'
import StepFrame from './StepFrame.vue'
import { useOnboardingText } from './use-onboarding-text'

const { useState, useProperties, useMethods, useMethodDiagnostics, widgetId, widgetType } = useWidget(InductionStepPlugin)
const { status, ticket, slot, reference, reason } = useState()
const { title, offered, missing } = useProperties()
const { requestSlot, cancelBooking } = useMethods()
const diagnostics = useMethodDiagnostics()
const { t, tf, text, date: formatDate } = useOnboardingText()
const board = useProblemBoard()
const anchor = useInspectAnchor(widgetId, widgetType)
const dateId = useId()
const timeId = useId()

const chosenDate = ref('')
const chosenTime = ref('')
const times = computed(() => offered.value?.times ?? [])
const time = computed(() => chosenTime.value === '' ? (times.value[0] ?? '') : chosenTime.value)

const needed = computed(() => (missing.value ?? []).map(code => code === 'booking-pending' ? t('missingBookingPending') : t('missingBooking')))
const offeredDays = computed(() => (offered.value?.days ?? []).map(formatDate)
	.join(', '))
const slotText = computed(() => slot.value === null ? '' : formatDate(slot.value.date))

const statusText = computed(() => {
	const values = { ticket: ticket.value ?? 0, date: slotText.value, time: slot.value?.time ?? '', reference: reference.value ?? '' }
	switch (status.value) {
		case 'requesting':
			return tf('inductionRequesting', values)
		case 'confirmed':
			return tf('inductionConfirmed', values)
		case 'declined':
			return tf('inductionDeclined', { ...values, reason: reason.value === 'fully-booked' ? t('reasonFullyBooked') : (reason.value ?? '') })
		default:
			return t('inductionIdle')
	}
})

function onRequest(): void {
	const succeeded = requestSlot(chosenDate.value, time.value) !== null
	reportCall(board, 'requestSlot', diagnostics.requestSlot.value, succeeded)
}

function onCancel(): void {
	const succeeded = cancelBooking() !== null
	reportCall(board, 'cancelBooking', diagnostics.cancelBooking.value, succeeded)
}
</script>

<template>
	<div
		v-bind="anchor"
		:data-tutorial-target="`onboarding-${widgetId}`"
	>
		<StepFrame
			:title="title === null ? widgetId : text(title)"
			:needed="needed"
		>
			<form
				class="induction-form"
				@submit.prevent="onRequest"
			>
				<div class="induction-field">
					<label
						:for="dateId"
						class="induction-label"
					>{{ t('inductionDate') }}</label>
					<input
						:id="dateId"
						type="date"
						class="induction-input"
						:style="FIELD_STYLE"
						:value="chosenDate"
						data-testid="induction-date"
						@input="chosenDate = ($event.target as HTMLInputElement).value"
					>
				</div>
				<div class="induction-field">
					<label
						:for="timeId"
						class="induction-label"
					>{{ t('inductionTime') }}</label>
					<select
						:id="timeId"
						class="induction-input"
						:style="FIELD_STYLE"
						:value="time"
						data-testid="induction-time"
						@change="chosenTime = ($event.target as HTMLSelectElement).value"
					>
						<option
							v-for="candidate in times"
							:key="candidate"
							:value="candidate"
						>
							{{ candidate }}
						</option>
					</select>
				</div>
				<button
					type="submit"
					class="induction-button"
					:style="PRIMARY_BUTTON_STYLE"
					data-testid="induction-request"
				>
					{{ t('inductionRequest') }}
				</button>
			</form>
			<p class="induction-offered">
				{{ tf('inductionOffered', { days: offeredDays }) }}
			</p>

			<div
				role="status"
				class="induction-status"
				:data-status="status"
				data-testid="induction-status"
				data-tutorial-target="onboarding-induction-status"
			>
				<p class="induction-status-text">
					{{ statusText }}
				</p>
				<button
					v-if="status === 'requesting' || status === 'confirmed'"
					type="button"
					class="induction-button"
					:style="BUTTON_STYLE"
					data-testid="induction-cancel"
					@click="onCancel"
				>
					{{ status === 'requesting' ? t('inductionCancelRequest') : t('inductionCancelBooking') }}
				</button>
			</div>

			<OfficeDesk />
		</StepFrame>
	</div>
</template>

<style scoped>
.induction-form {
	display: flex;
	flex-wrap: wrap;
	align-items: flex-end;
	gap: 12px;
}

.induction-field {
	display: flex;
	flex-direction: column;
	gap: 4px;
}

.induction-label {
	font-size: 14px;
	color: var(--onboarding-text-muted);
}

.induction-input,
.induction-button {
	min-height: 36px;
	padding: 4px 10px;
	border-radius: var(--onboarding-radius);
	background: var(--onboarding-surface-alt);
	box-sizing: border-box;
}

.induction-button {
	cursor: pointer;
}

.induction-input:focus-visible,
.induction-button:focus-visible {
	outline: 2px solid var(--onboarding-accent);
	outline-offset: 2px;
}

.induction-offered {
	margin: 0;
	font-size: 13px;
	color: var(--onboarding-text-muted);
}

.induction-status {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
	padding: 10px 12px;
	border: 1px solid var(--onboarding-border);
	border-left-width: 4px;
	border-radius: var(--onboarding-radius);
	background: var(--onboarding-surface-alt);
}

.induction-status[data-status='confirmed'] {
	border-left-color: var(--onboarding-ok);
}

.induction-status[data-status='declined'] {
	border-left-color: var(--onboarding-danger);
}

.induction-status[data-status='requesting'] {
	border-left-color: var(--onboarding-accent);
}

.induction-status-text {
	flex: 1 1 240px;
	margin: 0;
}
</style>
