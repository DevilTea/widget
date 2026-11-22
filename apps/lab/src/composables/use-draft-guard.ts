/**
 * Vue bridge over `lab/draft-guard.ts`: the one place that decides, from `LabStore.jsonBlocked` and
 * `LabStore.hasCommittedEdits`, whether loading a preset or switching showcase must first ask the user
 * (`DraftGuardDialog.vue` renders the question, naming what would be lost). It owns no Document, draft or Runtime
 * state; it only calls the action it was handed once the user has agreed (or when nothing would be lost).
 *
 * A preset load is undoable (an ordinary commit), so committed edits alone never ask: `LabStore.applyPreset()` then
 * offers Undo through `replacedNotice`. A showcase switch is not, so it asks about committed edits too.
 *
 * The tutorial's own start confirmation (`use-tutorial.ts`) is separate on purpose: it also drives the tour state
 * machine, and its start path calls `store.switchShowcase()`/`applyPreset()` directly, so it never asks twice.
 */

import type { InjectionKey, Ref } from 'vue'
import type { ReplacementLoss } from '../lab/draft-guard'
import type { LabStore } from './use-lab-store'
import { inject, shallowRef } from 'vue'
import { createDraftGuard, replacementLoss } from '../lab/draft-guard'

export interface DraftGuardRequest {
	/** What is about to be loaded (a preset or showcase label, already translated), for the confirmation text. */
	readonly subject: string
	/** `true` for a preset load (Undo can take it back), `false` for a showcase switch. */
	readonly undoable: boolean
	readonly run: () => void
}

export interface DraftGuardStore {
	readonly confirmVisible: Readonly<Ref<boolean>>
	/** What is about to be loaded (a preset or showcase label), for the confirmation text. */
	readonly subject: Readonly<Ref<string>>
	/** What confirming discards while the confirmation is open (`none` otherwise). */
	readonly loss: Readonly<Ref<ReplacementLoss>>
	/** Runs `run` at once when nothing would be lost; otherwise opens the confirmation and runs it on confirm. */
	request: (request: DraftGuardRequest) => void
	confirm: () => void
	cancel: () => void
}

export const DraftGuardKey: InjectionKey<DraftGuardStore> = Symbol('widget-lab:draft-guard')

export function createDraftGuardStore(store: Pick<LabStore, 'jsonBlocked' | 'hasCommittedEdits'>): DraftGuardStore {
	const confirmVisible = shallowRef(false)
	const subject = shallowRef('')
	const loss = shallowRef<ReplacementLoss>('none')
	const guard = createDraftGuard(() => {
		const pending = guard.getPending()
		confirmVisible.value = pending !== null
		if (pending !== null) {
			subject.value = pending.subject
			loss.value = pending.loss
		}
	})
	return {
		confirmVisible,
		subject,
		loss,
		request: ({ subject: nextSubject, undoable, run }) => {
			guard.request({
				loss: replacementLoss({ jsonBlocked: store.jsonBlocked.value, hasCommittedEdits: store.hasCommittedEdits.value, undoable }),
				subject: nextSubject,
				run,
			})
		},
		confirm: () => {
			guard.confirm()
		},
		cancel: () => guard.cancel(),
	}
}

export function useDraftGuard(): DraftGuardStore {
	const store = inject(DraftGuardKey)
	if (store === undefined)
		throw new Error('useDraftGuard() was called outside the DraftGuard provider (App.vue).')
	return store
}
