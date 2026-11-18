<script setup lang="ts">
/**
 * Presentation only: the wizard's title, the step list, the current step (the `steps` slot, one step at a time), Back /
 * Next / Finish, a "go to step number" box, the one alert that explains a refused call, the finished card and the
 * activity list of the host.
 *
 * The page paints itself from its own `--onboarding-*` custom properties, chosen by the host's light/dark theme
 * (`useShowcaseHost()` of the showcase host contract); no chrome token is used.
 *
 * Reads: Properties `title`, `steps` and `progress` (and `answers` once finished), State `finished`. Calls Methods
 * `next`, `back`, `goTo` and `finish`; every refusal is the Method's own diagnostic, mirrored on the problem board
 * (`./problem-board.ts`) as the single alert. Nothing is checked here: whether a step is complete, locked or out of
 * range is the plugin's.
 *
 * It also owns what the host does for it (`./onboarding-host.ts`): the host heard `stepChanged`, so focus moves to the
 * heading of the step that was entered.
 */
import { useWidget } from '@deviltea/widget-vue'
import { computed, inject, nextTick, provide, ref, useId, watch } from 'vue'
import { useInspectAnchor, useShowcaseHost } from '../../../showcase-host'
import { OnboardingPlugin } from '../plugins/onboarding'
import { BUTTON_STYLE, FIELD_STYLE, PRIMARY_BUTTON_STYLE } from './control-style'
import HostActivity from './HostActivity.vue'
import { OnboardingHostKey } from './onboarding-host'
import { createProblemBoard, ProblemBoardKey, reportCall } from './problem-board'
import { useOnboardingText } from './use-onboarding-text'

const { useState, useProperties, useMethods, useMethodDiagnostics, WidgetSlot, widgetId, widgetType } = useWidget(OnboardingPlugin)
const { finished } = useState()
const { title, steps, progress, answers } = useProperties()
const { next, back, goTo, finish } = useMethods()
const diagnostics = useMethodDiagnostics()
const host = useShowcaseHost()
const onboardingHost = inject(OnboardingHostKey, null)
const { t, tf, text, date, problem: explain } = useOnboardingText()

const board = createProblemBoard()
provide(ProblemBoardKey, board)

const anchor = useInspectAnchor(widgetId, widgetType)
const jumpId = useId()
const jumpHintId = useId()
const stepsHeadingId = useId()
const stepRegion = ref<HTMLElement | null>(null)
const jumpText = ref('')

const count = computed(() => progress.value?.count ?? 0)
const current = computed(() => progress.value?.current ?? 0)
const furthest = computed(() => progress.value?.furthest ?? 0)
const isLast = computed(() => count.value > 0 && current.value >= count.value - 1)
const isFinished = computed(() => finished.value === true)

interface Summary {
	readonly name: string
	readonly email: string
	readonly slot: string
	readonly reference: string
}

/** What the finished card says, found in the `answers` of the steps by their shape (a step's id is the document's choice). */
const summary = computed<Summary>(() => {
	const all = Object.values(answers.value ?? {}) as readonly unknown[]
	const account = all.find((entry): entry is { name: string, email: string } => typeof entry === 'object' && entry !== null && typeof (entry as { email?: unknown }).email === 'string')
	const booking = all.find((entry): entry is { slot: { date: string, time: string } | null, reference: string | null } => typeof entry === 'object' && entry !== null && 'slot' in entry)
	return {
		name: account?.name ?? '',
		email: account?.email ?? '',
		slot: booking?.slot ? `${date(booking.slot.date)} ${booking.slot.time}` : '',
		reference: booking?.reference ?? '',
	}
})

function stateOf(index: number): 'done' | 'current' | 'locked' | 'open' {
	if (index === current.value)
		return 'current'
	if (steps.value?.[index]?.complete === true)
		return 'done'
	return index > furthest.value ? 'locked' : 'open'
}

function onNext(): void {
	const succeeded = next() !== null
	reportCall(board, 'next', diagnostics.next.value, succeeded, { clearAll: true })
}

function onBack(): void {
	const succeeded = back() !== null
	reportCall(board, 'back', diagnostics.back.value, succeeded, { clearAll: true })
}

function onFinish(): void {
	const succeeded = finish() !== null
	reportCall(board, 'finish', diagnostics.finish.value, succeeded, { clearAll: true })
}

/** A step button asks for that step: a locked one is refused by the Method (the page does not decide). */
function goToIndex(index: number): void {
	const succeeded = goTo(index) !== null
	reportCall(board, 'goTo', diagnostics.goTo.value, succeeded, { clearAll: true })
}

function onJump(): void {
	// Exactly what was typed: an empty box is NaN, "1.5" is 1.5. goTo(index) validates it, not this page.
	goToIndex(jumpText.value.trim() === '' ? Number.NaN : Number(jumpText.value))
}

function onStartOver(): void {
	board.clear()
	onboardingHost?.resetAll()
}

// The host heard `stepChanged`: move focus to the heading of the step that was entered. The new step renders after the
// Property that says where the wizard is has updated, so wait (a few ticks at most) until it is in the page.
watch(() => onboardingHost?.lastStepChange.value?.nonce, async () => {
	const to = onboardingHost?.lastStepChange.value?.change.to
	if (to === undefined)
		return
	for (let attempt = 0; attempt < 5; attempt++) {
		await nextTick()
		const entered = stepRegion.value?.querySelector<HTMLElement>(`[data-widget-id="${CSS.escape(to)}"]`)
		if (entered !== null && entered !== undefined) {
			entered.querySelector<HTMLElement>('h2')
				?.focus()
			return
		}
	}
})

const problemText = computed(() => {
	const latest = board.latest.value
	return latest === null ? null : explain(latest.reason, latest.message)
})
</script>

<template>
	<main
		v-bind="anchor"
		data-tutorial-target="onboarding-onboarding"
		:data-onboarding-theme="host.theme.value"
		class="onboarding"
		:aria-labelledby="stepsHeadingId"
	>
		<header class="onboarding-header">
			<h1
				:id="stepsHeadingId"
				class="onboarding-title"
			>
				{{ title === null ? widgetId : text(title) }}
			</h1>
			<p
				v-if="!isFinished && count > 0"
				class="onboarding-progress"
				data-testid="onboarding-progress"
			>
				{{ tf('stepOf', { n: current + 1, count }) }}
			</p>
		</header>

		<template v-if="!isFinished">
			<nav
				:aria-label="t('stepsNav')"
				class="onboarding-steps"
				data-tutorial-target="onboarding-steps"
			>
				<ol class="onboarding-step-list">
					<li
						v-for="(step, index) in steps ?? []"
						:key="step.id"
						class="onboarding-step-item"
					>
						<button
							type="button"
							class="onboarding-step-button"
							:class="`onboarding-step-button--${stateOf(index)}`"
							:style="BUTTON_STYLE"
							:aria-current="index === current ? 'step' : undefined"
							:data-testid="`onboarding-step-${step.id}`"
							:data-state="stateOf(index)"
							@click="goToIndex(index)"
						>
							<span
								class="onboarding-step-number"
								aria-hidden="true"
							>{{ index + 1 }}</span>
							<span class="onboarding-step-name">{{ text(step.title) }}</span>
							<span
								v-if="stateOf(index) === 'done'"
								class="onboarding-step-tag"
							>{{ t('stepDone') }}</span>
							<span
								v-else-if="stateOf(index) === 'locked'"
								class="onboarding-step-tag"
							>{{ t('stepLocked') }}</span>
						</button>
					</li>
				</ol>
			</nav>

			<div
				ref="stepRegion"
				class="onboarding-current"
				data-testid="onboarding-current"
			>
				<WidgetSlot name="steps">
					<template #default="{ Child, index }">
						<component
							:is="Child"
							v-if="index === current"
						/>
					</template>
				</WidgetSlot>
			</div>

			<div
				class="onboarding-actions"
				data-tutorial-target="onboarding-actions"
			>
				<button
					type="button"
					class="onboarding-button"
					:style="BUTTON_STYLE"
					:disabled="current === 0"
					data-testid="onboarding-back"
					@click="onBack"
				>
					{{ t('back') }}
				</button>
				<button
					v-if="!isLast"
					type="button"
					class="onboarding-button"
					:style="PRIMARY_BUTTON_STYLE"
					data-testid="onboarding-next"
					@click="onNext"
				>
					{{ t('next') }}
				</button>
				<button
					v-else
					type="button"
					class="onboarding-button"
					:style="PRIMARY_BUTTON_STYLE"
					data-testid="onboarding-finish"
					@click="onFinish"
				>
					{{ t('finish') }}
				</button>
			</div>

			<form
				class="onboarding-jump"
				data-tutorial-target="onboarding-jump"
				@submit.prevent="onJump"
			>
				<label
					:for="jumpId"
					class="onboarding-jump-label"
				>{{ t('jumpLabel') }}</label>
				<input
					:id="jumpId"
					v-model="jumpText"
					type="text"
					inputmode="decimal"
					autocomplete="off"
					class="onboarding-input onboarding-jump-input"
					:style="FIELD_STYLE"
					:aria-describedby="jumpHintId"
					data-testid="onboarding-jump-input"
				>
				<button
					type="submit"
					class="onboarding-button"
					:style="BUTTON_STYLE"
					data-testid="onboarding-jump-go"
				>
					{{ t('jumpGo') }}
				</button>
				<p
					:id="jumpHintId"
					class="onboarding-hint"
				>
					{{ t('jumpHint') }}
				</p>
			</form>
		</template>

		<section
			v-else
			class="onboarding-card onboarding-finished"
			data-testid="onboarding-finished"
		>
			<h2
				class="onboarding-card-title"
			>
				{{ tf('finishedHeading', { name: summary.name }) }}
			</h2>
			<p>{{ tf('finishedBody', { slot: summary.slot, reference: summary.reference }) }}</p>
			<p>{{ tf('finishedMail', { email: summary.email }) }}</p>
			<button
				type="button"
				class="onboarding-button"
				:style="BUTTON_STYLE"
				:title="t('startOverHint')"
				data-testid="onboarding-start-over"
				@click="onStartOver"
			>
				{{ t('startOver') }}
			</button>
		</section>

		<p
			v-if="problemText !== null && board.latest.value !== null"
			role="alert"
			class="onboarding-problem"
			data-testid="onboarding-problem"
			data-tutorial-target="onboarding-problem"
		>
			<strong>{{ tf('refused', { method: board.latest.value.method }) }}</strong>
			<span class="onboarding-problem-text">{{ problemText }}</span>
			<code
				class="onboarding-problem-code"
				data-testid="onboarding-problem-code"
			>{{ board.latest.value.code }}<template v-if="board.latest.value.reason !== undefined"> · {{ board.latest.value.reason }}</template></code>
		</p>

		<HostActivity />
	</main>
</template>

<style scoped>
/* Dark is the default, like the frame; light is chosen by `data-onboarding-theme`. Every descendant inherits these. */
.onboarding {
	--onboarding-bg: #14161a;
	--onboarding-surface: #1b1e24;
	--onboarding-surface-alt: #22262e;
	--onboarding-border: #2c313a;
	--onboarding-text: #e6e8eb;
	--onboarding-text-muted: #9aa2af;
	--onboarding-accent: #5b9dff;
	--onboarding-on-accent: #0b1220;
	--onboarding-danger: #ff7a80;
	--onboarding-ok: #3fbf7f;
	--onboarding-radius: 6px;
	--onboarding-font-mono: "SFMono-Regular", ui-monospace, Menlo, Consolas, monospace;
	background: var(--onboarding-bg);
	min-height: 100%;
}

.onboarding[data-onboarding-theme='light'] {
	--onboarding-bg: #f6f7f9;
	--onboarding-surface: #ffffff;
	--onboarding-surface-alt: #eef1f5;
	--onboarding-border: #d4d9e2;
	--onboarding-text: #1b1f24;
	--onboarding-text-muted: #596273;
	--onboarding-accent: #1769e0;
	--onboarding-on-accent: #ffffff;
	--onboarding-danger: #b3262f;
	--onboarding-ok: #18794e;
}

.onboarding {
	display: flex;
	flex-direction: column;
	gap: 16px;
	box-sizing: border-box;
	min-height: 100vh;
	padding: 20px max(20px, calc((100% - 720px) / 2));
	color: var(--onboarding-text);
	font-size: 15px;
	color-scheme: dark;
}

.onboarding[data-onboarding-theme='light'] {
	color-scheme: light;
}

.onboarding-header {
	display: flex;
	flex-wrap: wrap;
	align-items: baseline;
	justify-content: space-between;
	gap: 8px 16px;
}

.onboarding-title {
	margin: 0;
	font-size: 26px;
	line-height: 1.25;
}

.onboarding-progress {
	margin: 0;
	font-size: 14px;
	color: var(--onboarding-text-muted);
}

.onboarding-step-list {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
	margin: 0;
	padding: 0;
	list-style: none;
}

.onboarding-step-button {
	display: inline-flex;
	align-items: center;
	gap: 8px;
	min-height: 36px;
	padding: 4px 12px 4px 6px;
	border-radius: 999px;
	background: var(--onboarding-surface);
	cursor: pointer;
}

.onboarding-step-button--current {
	background: var(--onboarding-surface-alt);
	outline: 2px solid var(--onboarding-accent);
	outline-offset: -2px;
}

.onboarding-step-button--locked .onboarding-step-name {
	color: var(--onboarding-text-muted);
}

.onboarding-step-number {
	display: inline-grid;
	place-items: center;
	width: 24px;
	height: 24px;
	border-radius: 50%;
	background: var(--onboarding-surface-alt);
	font-size: 13px;
}

.onboarding-step-button--done .onboarding-step-number {
	background: var(--onboarding-ok);
	color: var(--onboarding-on-accent);
}

.onboarding-step-button--current .onboarding-step-number {
	background: var(--onboarding-accent);
	color: var(--onboarding-on-accent);
}

.onboarding-step-tag {
	font-size: 12px;
	font-weight: 400;
	color: var(--onboarding-text-muted);
}

.onboarding-current {
	display: flex;
	flex-direction: column;
}

.onboarding-actions,
.onboarding-jump {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 8px;
}

.onboarding-jump-label {
	font-size: 14px;
	color: var(--onboarding-text-muted);
}

.onboarding-jump-input {
	width: 96px;
}

.onboarding-hint {
	flex-basis: 100%;
	margin: 0;
	font-size: 13px;
	color: var(--onboarding-text-muted);
}

/* Text colour, size, weight and border of the controls are set inline (`control-style.ts`). */
.onboarding-input,
.onboarding-button {
	min-height: 36px;
	padding: 4px 10px;
	border-radius: var(--onboarding-radius);
	background: var(--onboarding-surface-alt);
	box-sizing: border-box;
}

.onboarding-button {
	cursor: pointer;
	min-width: 72px;
}

.onboarding-button:disabled {
	cursor: not-allowed;
	opacity: 0.55;
}

.onboarding-step-button:focus-visible,
.onboarding-button:focus-visible,
.onboarding-input:focus-visible {
	outline: 2px solid var(--onboarding-accent);
	outline-offset: 2px;
}

.onboarding-card {
	display: flex;
	flex-direction: column;
	align-items: flex-start;
	gap: 8px;
	padding: 16px;
	border: 1px solid var(--onboarding-border);
	border-radius: var(--onboarding-radius);
	background: var(--onboarding-surface);
}

.onboarding-card-title {
	margin: 0;
	font-size: 20px;
}

.onboarding-finished p {
	margin: 0;
}

.onboarding-problem {
	display: flex;
	flex-wrap: wrap;
	align-items: baseline;
	gap: 4px 10px;
	margin: 0;
	padding: 10px 12px;
	border: 1px solid var(--onboarding-danger);
	border-radius: var(--onboarding-radius);
	background: var(--onboarding-surface);
	color: var(--onboarding-text);
}

.onboarding-problem strong {
	color: var(--onboarding-danger);
}

.onboarding-problem-code {
	margin-left: auto;
	font-family: var(--onboarding-font-mono);
	font-size: 12px;
	color: var(--onboarding-text-muted);
}
</style>
