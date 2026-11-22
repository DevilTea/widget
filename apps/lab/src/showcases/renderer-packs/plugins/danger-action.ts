/**
 * `DangerAction`: a button that needs a confirmation before it does anything. The confirmation is State (`confirming`), so
 * every pack draws the same question from the same fact:
 *
 * - `ask()` opens the question (State `confirming: true`). Asking twice is refused (`already-asking`).
 * - `cancel()` closes it. Cancelling when nothing is asked is refused (`not-asking`).
 * - `confirm()` is the action. It is refused unless the question is open (`not-asking`: nothing is written or emitted).
 *   Otherwise it invokes the Notifier's `notify` Method through the dependency `dep.widget(<config.notifier>)`, closes the
 *   question and emits `confirmed`. The Notifier is named by id: Core has no nearest-ancestor lookup. If the Notifier refuses
 *   the notification, nothing else happens and the refusal is this Method's diagnostic (`notifier-refused`).
 *
 * Every Method writes State, and `confirm` also emits, so Relations marks `ask` and `cancel` W and `confirm` W and E. `confirm`
 * lists `confirmed` in `emits`; the `notified` Event it causes belongs to the Notifier, whose Method it invokes (a Method that
 * emits only through another Method it invokes declares nothing for that).
 */

import type { WidgetInterfaces } from '@deviltea/widget-core'
import type { DangerActionConfig, DangerActionRawConfig } from '../config'
import type { Density, I18nText, Tone } from '../domain'
import { createWidgetPlugin } from '@deviltea/widget-core'
import { checkDangerActionConfig, resolveDangerActionConfig } from '../config'
import { isBoolean, isDensity, isNumber } from '../domain'
import { checkInsideSection, checkProvider, densityReads, providerId } from './structure'

export interface ConfirmedAction {
	readonly tone: Tone
	readonly message: I18nText
}

/**
 * A button that needs a confirmation. State `confirming`. Methods: `ask()` and `cancel()` (write State), `confirm()` (invokes
 * the `notify` Method of the Notifier named in the `notifier` config through dep.widget(id), closes the question and emits
 * `confirmed`). Refusals (`already-asking`, `not-asking`, `notifier-refused`) are Method diagnostics and change nothing.
 * Properties: `label`, `confirmText`, `message`, `tone` and `density` (read from the Appearance named in the `appearance`
 * config).
 */
export interface DangerActionInterfaces extends WidgetInterfaces {
	/**
	 * The button label, the question, the notification a confirmed action leaves and its tone, the Notifier it reports to and
	 * the Appearance it reads.
	 */
	config: { raw: DangerActionRawConfig, resolved: DangerActionConfig }
	state: {
		/** Whether the confirmation question is open. */
		confirming: boolean
	}
	properties: {
		/** The button label per language. */
		label: I18nText
		/** The confirmation question per language. */
		confirmText: I18nText
		/** The notification a confirmed action leaves, per language. */
		message: I18nText
		/** The tone of that notification. */
		tone: Tone
		/** `comfortable` or `compact`: the `density` State of the Appearance named in the `appearance` config, read through `dep.widget(id)`; `comfortable` when it cannot be read. */
		density: Density
	}
	methods: {
		/**
		 * Opens the confirmation question. Refused (`already-asking`) while it is open.
		 *
		 * @returns Whether the question was opened.
		 */
		ask: () => boolean
		/**
		 * Closes the confirmation question. Refused (`not-asking`) while none is open.
		 *
		 * @returns Whether the question was closed.
		 */
		cancel: () => boolean
		/**
		 * The action: tells the Notifier (its `notify` Method), closes the question and emits `confirmed`. Refused (`not-asking`)
		 * unless the question is open, and (`notifier-refused`) when the Notifier refuses or is missing.
		 *
		 * @returns Whether the action was confirmed.
		 */
		confirm: () => boolean
	}
	events: {
		/** The action was confirmed and the Notifier was told. Carries the tone and the text of the notification. */
		confirmed: [action: ConfirmedAction]
	}
}

export const DangerActionPlugin = createWidgetPlugin('DangerAction')
	.interfaces<DangerActionInterfaces>()
	.config({
		validate: (input, ctx): input is DangerActionRawConfig => {
			checkDangerActionConfig(input, diagnostic => ctx.addDiagnostic(diagnostic))
			return !ctx.hasAnyDiagnostic()
		},
		resolve: resolveDangerActionConfig,
	})
	.structure((ctx) => {
		checkInsideSection(ctx, 'DangerAction')
		// A recovered config (it failed its own validation, which is reported) names nothing worth checking.
		if (ctx.config.recovered)
			return
		checkProvider(ctx, ctx.config.appearance, 'Appearance', 'appearance')
		checkProvider(ctx, ctx.config.notifier, 'Notifier', 'notifier')
	})
	.state(state => state.confirming({
		validate: (input): input is boolean => isBoolean(input),
		default: () => false,
	}))
	.properties(properties => properties
		.label({ compute: ({ config }) => config.label })
		.confirmText({ compute: ({ config }) => config.confirmText })
		.message({ compute: ({ config }) => config.message })
		.tone({ compute: ({ config }) => config.tone })
		.density({
			registerDeps: ({ dep, blueprint, config }) => densityReads(dep, blueprint, config.appearance),
			compute: ({ deps }) => {
				const density = deps.density?.()
				return density?.ok === true && isDensity(density.value) ? density.value : 'comfortable'
			},
		}))
	.methods(methods => methods
		.ask({
			validateArgs: (args): args is [] => args.length === 0,
			registerDeps: ({ dep }) => ({
				confirming: dep.self.state.get('confirming'),
				setConfirming: dep.self.state.set('confirming'),
			}),
			execute: ({ deps, addDiagnostic }) => {
				const confirming = deps.confirming()
				if (!confirming.ok)
					return false
				if (confirming.value === true) {
					addDiagnostic({ message: 'The confirmation is already open: confirm or cancel it first.', reason: 'already-asking' })
					return false
				}
				deps.setConfirming(true)
				return true
			},
		})
		.cancel({
			validateArgs: (args): args is [] => args.length === 0,
			registerDeps: ({ dep }) => ({
				confirming: dep.self.state.get('confirming'),
				setConfirming: dep.self.state.set('confirming'),
			}),
			execute: ({ deps, addDiagnostic }) => {
				const confirming = deps.confirming()
				if (!confirming.ok)
					return false
				if (confirming.value !== true) {
					addDiagnostic({ message: 'There is no open confirmation to cancel.', reason: 'not-asking' })
					return false
				}
				deps.setConfirming(false)
				return true
			},
		})
		.confirm({
			validateArgs: (args): args is [] => args.length === 0,
			registerDeps: ({ dep, blueprint, config }) => {
				const notifier = providerId(blueprint, config.notifier, 'Notifier')
				return {
					confirming: dep.self.state.get('confirming'),
					setConfirming: dep.self.state.set('confirming'),
					message: dep.self.properties.get('message'),
					tone: dep.self.properties.get('tone'),
					// The Notifier is named by id, never found by ancestry. Declared only for a Notifier that exists: a name that
					// matches none is the structure rule's diagnostic, not a second dependency diagnostic.
					...(notifier === null
						? {}
						: { notify: dep.widget(notifier)
								.methods
								.invoke('notify')
								.validate(isNumber) }),
				}
			},
			emits: ['confirmed'],
			execute: ({ deps, emit, addDiagnostic }) => {
				const confirming = deps.confirming()
				const message = deps.message()
				const tone = deps.tone()
				if (!confirming.ok || !message.ok || !tone.ok)
					return false
				if (confirming.value !== true) {
					addDiagnostic({ message: 'Nothing to confirm: ask() opens the confirmation first.', reason: 'not-asking' })
					return false
				}
				if (deps.notify === undefined) {
					addDiagnostic({ message: 'There is no Notifier to report to.', reason: 'notifier-refused' })
					return false
				}
				const notified = deps.notify(message.value, tone.value)
				if (!notified.ok) {
					addDiagnostic({ message: 'The Notifier refused the notification, so the action was not confirmed.', reason: 'notifier-refused' })
					return false
				}
				deps.setConfirming(false)
				emit.confirmed({ tone: tone.value, message: message.value })
				return true
			},
		}))
	.events(['confirmed'])
	.done()
