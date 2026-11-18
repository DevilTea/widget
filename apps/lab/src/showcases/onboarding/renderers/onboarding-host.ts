/**
 * The host of one onboarding Runtime: everything that belongs to whoever owns the Runtime and that `useWidget()`
 * deliberately does not hand a renderer. `OnboardingRenderer` (`./index.ts`) creates one host per Runtime and provides
 * it to the renderers below it.
 *
 * **The host is where the waiting happens.** Core is synchronous: a Method cannot await anything, and the `emit` and
 * `deps` callables of a Method stop working when it returns. So the widgets only announce, through Events, and the host
 * listens:
 *
 * - `induction.slotRequested`: the host asks the booking office (`../booking-office.ts`). The office answers later,
 *   after a delay the host controls (or when the visitor presses "Let the office answer"), and the host writes the
 *   answer back with the Method `settleBooking(ticket, outcome)`: an ordinary synchronous call from outside Core.
 * - `induction.slotCancelled`: a host that can recall a request does (the timer is cleared and no answer comes). A host
 *   that cannot (the "office cannot recall" switch) keeps waiting, and the late answer is ignored by `settleBooking`
 *   because its ticket is no longer the newest: that is the guard Core's "Async work" guide describes for work that cannot
 *   be cancelled.
 * - `onboarding.stepChanged`: the host asks the renderer to move focus to the new step's heading (`lastStepChange`).
 * - `onboarding.completed`: the host "sends the welcome message" (a line in its activity list; nothing leaves the page).
 * - **Runtime disposal and unmount**: every pending request is cancelled and no answer is ever delivered afterwards.
 *   Work that could not be cancelled would check `runtime.isDisposed` before it writes; `deliver()` does.
 *
 * A host is created and disposed with the component that provides it; it keeps no module state. The two switches
 * (`hold`, `recall`) are host settings, not widget State: the office is outside Core.
 */

import type { InjectionKey, Ref } from 'vue'
import type { Scheduler } from '../booking-office'
import type { SlotRequest, StepChange } from '../domain'
import type { OnboardingRuntime } from '../system'
import { shallowRef, watch } from 'vue'
import { OFFICE_DELAY_MS, officeAnswer, realScheduler } from '../booking-office'
import { stepChildrenOfView } from '../plugins/structure'

/** What a line of the host's activity list says; the renderer turns it into text in the viewer's language. */
export type HostActivityKind
	= | 'step-changed'
		| 'slot-requested'
		| 'office-held'
		| 'office-answered'
		| 'answer-applied'
		| 'answer-ignored'
		| 'answer-failed'
		| 'recalled'
		| 'not-recalled'
		| 'slot-released'
		| 'welcome-queued'

export interface HostActivity {
	/** 1, 2, 3...: the order the host recorded them in, a stable list key. */
	readonly sequence: number
	readonly kind: HostActivityKind
	/** The values the line's text fills in (ticket, date, time, step ids, ...). */
	readonly values: Readonly<Record<string, string | number>>
}

/** A request the host has sent to the office and has no answer for yet. */
export interface PendingRequest extends SlotRequest {
	/** `held`: waiting for the visitor to let the office answer. `waiting`: the office is answering after its delay. */
	readonly phase: 'held' | 'waiting'
	/** `true` when the visitor cancelled it but the office cannot recall it: its answer will still arrive, and be ignored. */
	readonly orphaned: boolean
}

export interface OnboardingHost {
	/** When on, the office answers only when told to (`answerNow`), so a request can be looked at while it waits. */
	readonly hold: Ref<boolean>
	/** When off, the office cannot recall a cancelled request: its answer still arrives and the ticket guard ignores it. */
	readonly recall: Ref<boolean>
	readonly pending: Readonly<Ref<readonly PendingRequest[]>>
	/** What the host did, oldest first (at most `MAX_ACTIVITY`). */
	readonly activity: Readonly<Ref<readonly HostActivity[]>>
	/** The latest step change the host heard, or `null`. `nonce` changes on every one, even to the same step. */
	readonly lastStepChange: Readonly<Ref<{ readonly nonce: number, readonly change: StepChange } | null>>
	/** Lets the office answer `ticket` now, whether it was held or waiting. */
	answerNow: (ticket: number) => void
	clearActivity: () => void
	/** `runtime.resetState()`, after the host has forgotten every request in flight (the tickets start again from 0). */
	resetAll: () => void
}

export interface OnboardingHostHandle {
	readonly host: OnboardingHost
	/** Stops listening, cancels every pending request and delivers nothing afterwards. */
	dispose: () => void
}

export interface OnboardingHostOptions {
	readonly scheduler?: Scheduler
	readonly delayMs?: number
}

export const OnboardingHostKey: InjectionKey<OnboardingHost> = Symbol('widget-lab:onboarding-host')

export const MAX_ACTIVITY = 30

interface InFlight {
	readonly request: SlotRequest
	phase: 'held' | 'waiting'
	orphaned: boolean
	cancel: () => void
}

export function createOnboardingHost(runtime: OnboardingRuntime, options: OnboardingHostOptions = {}): OnboardingHostHandle {
	const scheduler = options.scheduler ?? realScheduler
	const delayMs = options.delayMs ?? OFFICE_DELAY_MS
	const hold = shallowRef(false)
	const recall = shallowRef(true)
	const pending = shallowRef<readonly PendingRequest[]>([])
	const activity = shallowRef<readonly HostActivity[]>([])
	const lastStepChange = shallowRef<{ readonly nonce: number, readonly change: StepChange } | null>(null)
	const inFlight = new Map<number, InFlight>()
	let sequence = 0
	let nonce = 0
	let disposed = false

	// A Runtime that is already gone has nothing to listen to (reading a widget of it would throw).
	const gone = runtime.isDisposed
	const rootWidget = gone
		? null
		: (() => {
				const widget = runtime.getWidget(runtime.blueprint.root.id)
				return widget?.type === 'Onboarding' ? widget : null
			})()
	const steps = gone ? [] : stepChildrenOfView(runtime.blueprint)
	const inductionWidget = gone
		? null
		: (() => {
				const id = steps.find(step => step.type === 'InductionStep')?.id
				const widget = id === undefined ? null : runtime.getWidget(id)
				return widget?.type === 'InductionStep' ? widget : null
			})()
	const accountId = steps.find(step => step.type === 'AccountStep')?.id

	function record(kind: HostActivityKind, values: Readonly<Record<string, string | number>> = {}): void {
		activity.value = [...activity.value, { sequence: ++sequence, kind, values }].slice(-MAX_ACTIVITY)
	}

	function publish(): void {
		pending.value = [...inFlight.values()].map(({ request, phase, orphaned }) => ({ ...request, phase, orphaned }))
	}

	function forget(ticket: number): void {
		inFlight.delete(ticket)
		publish()
	}

	/** The office answers: the host writes the answer back through the Method, unless the Runtime is gone. */
	function deliver(ticket: number): void {
		const entry = inFlight.get(ticket)
		if (entry === undefined)
			return
		entry.cancel()
		forget(ticket)
		// Disposal clears `inFlight`, so a callback that outlives the Runtime finds no entry above. The flag is the second
		// line: work that cannot be cancelled resumes whether or not the Runtime is alive, and a Method call on a
		// disposed Runtime throws.
		if (disposed || runtime.isDisposed || inductionWidget === null)
			return
		const outcome = officeAnswer(entry.request)
		record('office-answered', { ticket, status: outcome.status })
		const result = inductionWidget.methods.settleBooking(ticket, outcome)
		if (!result.ok)
			record('answer-failed', { ticket })
		else
			record(result.value ? 'answer-applied' : 'answer-ignored', { ticket, status: outcome.status })
	}

	function startTimer(entry: InFlight): void {
		entry.phase = 'waiting'
		entry.cancel = scheduler.after(() => deliver(entry.request.ticket), delayMs)
	}

	const stops: (() => void)[] = []
	let stopDisposal: () => void = () => {}

	if (inductionWidget !== null) {
		stops.push(inductionWidget.events.slotRequested.subscribe((request) => {
			if (disposed)
				return
			record('slot-requested', { ticket: request.ticket, date: request.date, time: request.time })
			const entry: InFlight = { request, phase: 'held', orphaned: false, cancel: () => {} }
			inFlight.set(request.ticket, entry)
			if (hold.value)
				record('office-held', { ticket: request.ticket })
			else
				startTimer(entry)
			publish()
		}))
		stops.push(inductionWidget.events.slotCancelled.subscribe((cancelled) => {
			if (disposed)
				return
			if (cancelled.wasConfirmed) {
				record('slot-released', { ticket: cancelled.ticket, date: cancelled.date, time: cancelled.time })
				return
			}
			const entry = inFlight.get(cancelled.ticket)
			if (entry === undefined)
				return
			if (recall.value) {
				entry.cancel()
				forget(cancelled.ticket)
				record('recalled', { ticket: cancelled.ticket })
			}
			else {
				entry.orphaned = true
				record('not-recalled', { ticket: cancelled.ticket })
				publish()
			}
		}))
	}

	if (rootWidget !== null) {
		stops.push(rootWidget.events.stepChanged.subscribe((change) => {
			if (disposed)
				return
			lastStepChange.value = { nonce: ++nonce, change }
			record('step-changed', { from: change.from, to: change.to, by: change.by })
		}))
		stops.push(rootWidget.events.completed.subscribe((completion) => {
			if (disposed)
				return
			const account = accountId === undefined ? undefined : completion.answers[accountId]
			const email = typeof account === 'object' && account !== null && typeof (account as { email?: unknown }).email === 'string' ? (account as { email: string }).email : ''
			record('welcome-queued', { email })
		}))
	}

	// Turning "hold" off lets the office answer what it was holding.
	stops.push(watch(hold, (held) => {
		if (held || disposed)
			return
		for (const entry of inFlight.values()) {
			if (entry.phase === 'held')
				startTimer(entry)
		}
		publish()
	}, { flush: 'sync' }))

	function dispose(): void {
		if (disposed)
			return
		disposed = true
		for (const stop of stops)
			stop()
		for (const entry of inFlight.values())
			entry.cancel()
		inFlight.clear()
		pending.value = []
		stopDisposal()
	}

	// A Runtime disposed from outside (a showcase switch, Apply) cancels the host's work the moment it goes.
	if (runtime.isDisposed)
		dispose()
	else
		stopDisposal = runtime.subscribeDisposal(dispose)

	return {
		host: {
			hold,
			recall,
			pending,
			activity,
			lastStepChange,
			answerNow: (ticket) => {
				if (!disposed && inFlight.has(ticket))
					deliver(ticket)
			},
			clearActivity: () => {
				activity.value = []
			},
			resetAll: () => {
				// A disposed host has no Runtime to reset (a Method or resetState on a disposed Runtime throws).
				if (disposed)
					return
				for (const entry of inFlight.values())
					entry.cancel()
				inFlight.clear()
				publish()
				runtime.resetState()
			},
		},
		dispose,
	}
}
