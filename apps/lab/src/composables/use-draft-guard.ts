/**
 * Vue bridge over `lab/draft-guard.ts`: the one place that decides, from `LabStore.isDirty`, whether loading
 * a preset or switching showcase must first ask the user about the unapplied editor draft
 * (`DraftGuardDialog.vue` renders the question). It owns no Document, draft or Runtime state; it only calls
 * the action it was handed once the user has agreed (or when nothing would be lost).
 *
 * The tutorial's own dirty-draft confirmation (`use-tutorial.ts`) is separate on purpose: it also drives the
 * tour state machine, and its start path calls `store.switchShowcase()`/`applyPreset()` directly, so it never
 * asks twice.
 */

import type { InjectionKey, Ref } from 'vue'
import type { LabStore } from './use-lab-store'
import { inject, shallowRef } from 'vue'
import { createDraftGuard } from '../lab/draft-guard'

export interface DraftGuardStore {
	readonly confirmVisible: Readonly<Ref<boolean>>
	/** What is about to be loaded (a preset or showcase label), for the confirmation text. */
	readonly subject: Readonly<Ref<string>>
	/** Runs `run` at once when no draft is unapplied; otherwise opens the confirmation and runs it on confirm. */
	request: (subject: string, run: () => void) => void
	confirm: () => void
	cancel: () => void
}

export const DraftGuardKey: InjectionKey<DraftGuardStore> = Symbol('widget-lab:draft-guard')

export function createDraftGuardStore(store: Pick<LabStore, 'isDirty'>): DraftGuardStore {
	const confirmVisible = shallowRef(false)
	const subject = shallowRef('')
	const guard = createDraftGuard(() => {
		const pending = guard.getPending()
		confirmVisible.value = pending !== null
		if (pending !== null)
			subject.value = pending.subject
	})
	return {
		confirmVisible,
		subject,
		request: (nextSubject, run) => {
			guard.request({ isDirty: store.isDirty.value, subject: nextSubject, run })
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
