/**
 * Session-local dismiss state for the five panels' first-use description bars (issue #25 P1 Scope F).
 * `sessionStorage`-backed, same as the tutorial's own welcome/completion flags (`tutorial/session-flags.ts`)
 * — dismissed once per browser session, never persisted beyond it, per the app's existing "no
 * persistence of Lab-local UI state" stance (see this app's `AGENTS.md` "Package boundaries").
 */

import type { Ref } from 'vue'
import { ref } from 'vue'

export interface DismissableNotice {
	readonly dismissed: Readonly<Ref<boolean>>
	dismiss: () => void
}

export function useDismissableNotice(storageKey: string): DismissableNotice {
	const dismissed = ref(sessionStorage.getItem(storageKey) === '1')
	function dismiss(): void {
		dismissed.value = true
		sessionStorage.setItem(storageKey, '1')
	}
	return { dismissed, dismiss }
}
