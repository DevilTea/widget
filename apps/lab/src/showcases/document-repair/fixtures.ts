/**
 * The "stored" drafts of the showcase: in-memory JSON fixtures that older versions of the notice-board app are imagined to
 * have saved. Nothing is read from or written to any storage. Each one is a document of the inner notice board system
 * (`./board/system.ts`) in the shape of the version it was saved with; `legacyV3` is already valid.
 *
 * They are plain JSON data (not widgets of the repair desk): the desk keeps them as the `source` of a `SavedDraft`.
 */

const BOARD_TITLE = { 'en': 'Maker space notices', 'zh-TW': '工坊公告欄' }

/** 1.x: slot `items`, type `Banner`, config `text`, a widget-level `style`, two notices with one id and one with none. */
export const legacyV1 = {
	id: 'board',
	type: 'Board',
	config: { title: BOARD_TITLE },
	slots: {
		items: [
			{ id: 'welcome', type: 'Banner', style: 'highlight', config: { title: 'Welcome back', text: 'The workshop reopens on Monday.', until: '2026-12-31', tone: 'info' } },
			{ id: 'closure', type: 'Banner', config: { title: 'Closed on Friday', text: 'The laser cutter is being serviced.', until: '2026-12-04', tone: 'warning' } },
			{ id: 'closure', type: 'Banner', config: { title: 'Closed on Saturday', text: 'No induction this week.', until: '2026-12-05', tone: 'warning' } },
			{ type: 'Banner', config: { title: 'Lost property', text: 'A grey scarf is waiting at the desk.', until: '2026-12-18', tone: 'info' } },
		],
	},
}

/** 2.x: the current slot and type, but `until` was stored as epoch milliseconds in two notices. */
export const legacyV2 = {
	id: 'board',
	type: 'Board',
	config: { title: BOARD_TITLE },
	slots: {
		notices: [
			{ id: 'welcome', type: 'Notice', config: { title: 'Welcome back', body: 'The workshop reopens on Monday.', until: Date.UTC(2026, 11, 31), tone: 'info' } },
			{ id: 'closure', type: 'Notice', config: { title: 'Closed on Friday', body: 'The laser cutter is being serviced.', until: Date.UTC(2026, 11, 4), tone: 'warning' } },
			{ id: 'hours', type: 'Notice', config: { title: 'New opening hours', body: 'Open until 21:00 on Thursdays.', until: '2027-01-31', tone: 'info' } },
		],
	},
}

/** 3.x: the current format, valid as it is. */
export const legacyV3 = {
	id: 'board',
	type: 'Board',
	config: { title: BOARD_TITLE },
	slots: {
		notices: [
			{ id: 'welcome', type: 'Notice', config: { title: 'Welcome back', body: 'The workshop reopens on Monday.', until: '2026-12-31', tone: 'info' } },
			{ id: 'closure', type: 'Notice', config: { title: 'Closed on Friday', body: 'The laser cutter is being serviced.', until: '2026-12-04', tone: 'warning' } },
		],
	},
}

/** 2.x, with a widget type (`Poll`) that no version of the app after it knows and for which the application has no repair rule. */
export const legacyPoll = {
	id: 'board',
	type: 'Board',
	config: { title: BOARD_TITLE },
	slots: {
		notices: [
			{ id: 'welcome', type: 'Notice', config: { title: 'Welcome back', body: 'The workshop reopens on Monday.', until: Date.UTC(2026, 11, 31), tone: 'info' } },
			{ id: 'vote', type: 'Poll', config: { question: 'Which evening suits you for the open day?', options: ['Thursday', 'Saturday'] } },
		],
	},
}
