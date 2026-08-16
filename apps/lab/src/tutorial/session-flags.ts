/**
 * Session-local tutorial flags (issue #25 P1 Scope B/OWNER decision): the tutorial has no persistence
 * of its own — "welcome dismissed" and "tour completed" are the only facts that survive a page reload,
 * and only for the current browser session (`sessionStorage`, never `localStorage`), per the locked
 * policy ("Persistence, draft restoration, and Runtime-state migration remain out of scope").
 *
 * `Storage`-shaped parameter (defaulting to the real `sessionStorage`) rather than a hard dependency on
 * the global, so this stays unit-testable without leaking state across test files that all run in the
 * same happy-dom/jsdom global.
 *
 * issue #25 P4: "tour completed" is now per-tour (`widget-lab:tutorial:completed:<tourId>`) — CRM's
 * availability gate (`use-tutorial.ts`'s `crmTourUnlocked`) needs to ask specifically "has the Survey
 * tour been completed this session?" independent of whether the CRM tour itself has ever been completed,
 * so one shared flag from P1 would conflate the two. `tourId` is a plain string (not a closed union)
 * to keep this module decoupled from which tour scripts exist, mirroring `TutorialActions.startTour()`'s
 * own plain-string parameter (`types.ts`).
 */

const WELCOME_DISMISSED_KEY = 'widget-lab:tutorial:welcome-dismissed'
const TOUR_COMPLETED_KEY_PREFIX = 'widget-lab:tutorial:completed:'

export function isWelcomeDismissed(storage: Storage = sessionStorage): boolean {
	return storage.getItem(WELCOME_DISMISSED_KEY) === '1'
}

export function markWelcomeDismissed(storage: Storage = sessionStorage): void {
	storage.setItem(WELCOME_DISMISSED_KEY, '1')
}

export function isTourCompleted(tourId: string, storage: Storage = sessionStorage): boolean {
	return storage.getItem(TOUR_COMPLETED_KEY_PREFIX + tourId) === '1'
}

export function markTourCompleted(tourId: string, storage: Storage = sessionStorage): void {
	storage.setItem(TOUR_COMPLETED_KEY_PREFIX + tourId, '1')
}
