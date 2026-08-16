/**
 * Session-local tutorial flags (issue #25 P1 Scope B/OWNER decision): the tutorial has no persistence
 * of its own — "welcome dismissed" and "tour completed" are the only two facts that survive a page
 * reload, and only for the current browser session (`sessionStorage`, never `localStorage`), per the
 * locked policy ("Persistence, draft restoration, and Runtime-state migration remain out of scope").
 *
 * `Storage`-shaped parameter (defaulting to the real `sessionStorage`) rather than a hard dependency on
 * the global, so this stays unit-testable without leaking state across test files that all run in the
 * same happy-dom/jsdom global.
 */

const WELCOME_DISMISSED_KEY = 'widget-lab:tutorial:welcome-dismissed'
const TOUR_COMPLETED_KEY = 'widget-lab:tutorial:completed'

export function isWelcomeDismissed(storage: Storage = sessionStorage): boolean {
	return storage.getItem(WELCOME_DISMISSED_KEY) === '1'
}

export function markWelcomeDismissed(storage: Storage = sessionStorage): void {
	storage.setItem(WELCOME_DISMISSED_KEY, '1')
}

export function isTourCompleted(storage: Storage = sessionStorage): boolean {
	return storage.getItem(TOUR_COMPLETED_KEY) === '1'
}

export function markTourCompleted(storage: Storage = sessionStorage): void {
	storage.setItem(TOUR_COMPLETED_KEY, '1')
}
