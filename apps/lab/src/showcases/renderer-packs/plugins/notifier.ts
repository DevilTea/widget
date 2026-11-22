/**
 * `Notifier`: a capability widget that keeps the page's notifications as State (`items`, newest last, at most `limit`).
 *
 * - `notify(message, tone)` appends a notification, writes State and emits `notified`; it returns the new id. It validates its
 *   arguments (`invalid-method-arguments`): the message is text per language and the tone is one of the known tones.
 * - `dismiss(id)` removes one. An id that is not there is refused (`invalid-method-result`, reason `no-such-item`): it writes
 *   nothing, emits nothing, and the refusal is the Method's latest diagnostic.
 *
 * Who calls `notify` is not the Notifier's business: a `DangerAction` names it in its config and invokes the Method through a
 * declared `dep.widget(id)` Method dependency. A Method that writes State and emits is not read-only, so no Property may depend
 * on it; the Properties here only read State.
 *
 * `alert` and `status` are what the page announces (`announcementsOf`): the newest `danger` notification and the newest of any
 * other tone, so a page has at most one alert and one status whichever pack draws it.
 */

import type { WidgetInterfaces } from '@deviltea/widget-core'
import type { NotifierConfig, NotifierRawConfig } from '../config'
import type { I18nText, NotifierItem, Tone } from '../domain'
import { createWidgetPlugin } from '@deviltea/widget-core'
import { checkNotifierConfig, resolveNotifierConfig } from '../config'
import { announcementsOf, appendNotification, describeValue, isI18nText, isNotifierItems, isTone } from '../domain'

/**
 * A capability widget: the page's notifications (State `items`, the newest `limit` of them). Methods: `notify(message, tone)`
 * (appends one, writes State and emits `notified`) and `dismiss(id)` (removes one; an unknown id is refused). Properties:
 * `alert` (the newest `danger` notification), `status` (the newest of any other tone), `count` and `limit`. A DangerAction
 * reports to it by naming it in its `notifier` config.
 */
export interface NotifierInterfaces extends WidgetInterfaces {
	/** How many notifications are kept. */
	config: { raw: NotifierRawConfig, resolved: NotifierConfig }
	state: {
		/** The notifications, newest last, at most `limit`. */
		items: readonly NotifierItem[]
	}
	properties: {
		/** How many notifications are kept. */
		limit: number
		/** The newest `danger` notification; `null` without one. */
		alert: NotifierItem | null
		/** The newest notification of any other tone; `null` without one. */
		status: NotifierItem | null
		/** How many notifications are kept now. */
		count: number
	}
	methods: {
		/**
		 * Appends a notification (dropping the oldest beyond `limit`), writes State and emits `notified`.
		 *
		 * @param message - The text per language, with a non-empty "en".
		 * @param tone - `info`, `success` or `danger`.
		 * @returns The id of the new notification.
		 */
		notify: (message: I18nText, tone: Tone) => number
		/**
		 * Removes a notification. An id that is not there is refused (`no-such-item`) and changes nothing.
		 *
		 * @param id - The id `notify` returned.
		 * @returns Whether a notification was removed.
		 */
		dismiss: (id: number) => boolean
	}
	events: {
		/** A notification was added. Carries its id, its text per language and its tone. */
		notified: [notification: NotifierItem]
	}
}

export const NotifierPlugin = createWidgetPlugin('Notifier')
	.interfaces<NotifierInterfaces>()
	.config({
		validate: (input, ctx): input is NotifierRawConfig => {
			checkNotifierConfig(input, diagnostic => ctx.addDiagnostic(diagnostic))
			return !ctx.hasAnyDiagnostic()
		},
		resolve: resolveNotifierConfig,
	})
	.state(state => state.items({
		validate: (input): input is readonly NotifierItem[] => isNotifierItems(input),
		default: () => [],
	}))
	.properties(properties => properties
		.limit({ compute: ({ config }) => config.limit })
		.alert({
			registerDeps: ({ dep }) => ({ items: dep.self.state.get('items') }),
			compute: ({ deps }) => {
				const items = deps.items()
				return announcementsOf(items.ok ? (items.value ?? []) : []).alert
			},
		})
		.status({
			registerDeps: ({ dep }) => ({ items: dep.self.state.get('items') }),
			compute: ({ deps }) => {
				const items = deps.items()
				return announcementsOf(items.ok ? (items.value ?? []) : []).status
			},
		})
		.count({
			registerDeps: ({ dep }) => ({ items: dep.self.state.get('items') }),
			compute: ({ deps }) => {
				const items = deps.items()
				return items.ok ? (items.value ?? []).length : 0
			},
		}))
	.methods(methods => methods
		.notify({
			validateArgs: (args, { addDiagnostic, hasAnyDiagnostic }): args is [I18nText, Tone] => {
				if (args.length !== 2) {
					addDiagnostic({ message: `notify(message, tone) takes exactly two arguments, got ${args.length}.`, reason: 'wrong-arity' })
					return false
				}
				const [message, tone] = args
				if (!isI18nText(message))
					addDiagnostic({ message: `notify: message must be text per language with a non-empty "en", got ${describeValue(message)}.`, path: [0], reason: 'invalid-message' })
				if (!isTone(tone))
					addDiagnostic({ message: `notify: tone must be "info", "success" or "danger", got ${describeValue(tone)}.`, path: [1], reason: 'unknown-tone' })
				return !hasAnyDiagnostic()
			},
			registerDeps: ({ dep }) => ({
				items: dep.self.state.get('items'),
				limit: dep.self.properties.get('limit'),
				setItems: dep.self.state.set('items'),
			}),
			emits: ['notified'],
			execute: ({ args: [message, tone], deps, emit }) => {
				const items = deps.items()
				const limit = deps.limit()
				if (!items.ok || !limit.ok)
					return 0 // the dependency failure is already recorded: the Method fails
				const next = appendNotification(items.value ?? [], message, tone, limit.value)
				deps.setItems(next.items)
				emit.notified({ id: next.id, message, tone })
				return next.id
			},
		})
		.dismiss({
			validateArgs: (args, { addDiagnostic, hasAnyDiagnostic }): args is [number] => {
				if (args.length !== 1) {
					addDiagnostic({ message: `dismiss(id) takes exactly one argument, got ${args.length}.`, reason: 'wrong-arity' })
					return false
				}
				if (typeof args[0] !== 'number' || !Number.isInteger(args[0]))
					addDiagnostic({ message: `dismiss: id must be a whole number, got ${describeValue(args[0])}.`, path: [0], reason: 'not-a-whole-number' })
				return !hasAnyDiagnostic()
			},
			registerDeps: ({ dep }) => ({
				items: dep.self.state.get('items'),
				setItems: dep.self.state.set('items'),
			}),
			execute: ({ args: [id], deps, addDiagnostic }) => {
				const items = deps.items()
				if (!items.ok)
					return false
				const current = items.value ?? []
				if (!current.some(item => item.id === id)) {
					addDiagnostic({ message: `There is no notification ${id}: it was dismissed or has been replaced by newer ones.`, reason: 'no-such-item' })
					return false
				}
				deps.setItems(current.filter(item => item.id !== id))
				return true
			},
		}))
	.events(['notified'])
	.done()
