/**
 * `DealStageForm` (checkpoint §2 "CRM-domain semantic widgets") — `config + slots + properties +
 * methods`. Owns no duplicate deal store: `stage-editor` (`SelectInput`) owns the draft stage State,
 * this widget coordinates it semantically.
 *
 * `canSave` is intentionally a renderer-facing semantic Property for UI gating/status only — it is not
 * an authoritative command guard, and `save()` does not consume/depend on it (checkpoint §2): `save()`
 * performs its own authoritative selected-deal/stage-refinement/`DealStore.updateStage` dependency reads.
 *
 * `open()` demonstrates a domain Method writing another reusable widget's declared State
 * (`stage-editor.value`) and invoking another reusable widget's Method (`Modal.open`) through
 * registered dependencies (checkpoint §2) — with no selected deal, it fails via `addDiagnostic` and the
 * Modal never opens; if writing `stage-editor.value` itself fails (e.g. a configured `stage-editor`
 * missing the selected deal's current stage among its options), `open()` also fails and returns before
 * invoking `Modal.open` (PR #22 review 4941241562 finding 3). `save()` propagates any
 * `DealStore.updateStage` failure as an ordinary method-dependency failure (no modal close, no fallback
 * mutation); on ok it invokes `Modal.close` and returns the updated `Deal`. `cancel()` only closes
 * the Modal — no store mutation.
 */

import type { WidgetInterfaces } from '@deviltea/widget-core'
import type { Deal } from '../domain'
import { createWidgetPlugin } from '@deviltea/widget-core'
import { isDeal, isDealStage, isPlainObject } from '../domain'

export interface DealStageFormRawConfig {
	readonly storeId: string
	readonly tableId: string
	readonly stageInputId: string
	readonly modalId: string
}

export interface DealStageFormInterfaces extends WidgetInterfaces {
	config: {
		raw: DealStageFormRawConfig
		resolved: DealStageFormRawConfig
	}
	slots: 'fields' | 'actions'
	properties: {
		selectedDeal: Deal | null
		canSave: boolean
	}
	methods: {
		open: () => void
		save: () => Deal
		cancel: () => void
	}
}

/** An inert placeholder — only ever returned on a failure path, where no consumer observes it. */
const DUMMY_DEAL: Deal = { id: '', company: '', contact: '', owner: '', stage: 'lead', amount: 0 }

function isDealStageFormRawConfig(input: unknown): input is DealStageFormRawConfig {
	return isPlainObject(input)
		&& typeof input.storeId === 'string'
		&& typeof input.tableId === 'string'
		&& typeof input.stageInputId === 'string'
		&& typeof input.modalId === 'string'
}

export const DealStageFormPlugin = createWidgetPlugin('DealStageForm')
	.description('Deal stage form widget')
	.interfaces<DealStageFormInterfaces>()
	.config({
		description: 'Deal stage form configuration',
		validate: (input): input is DealStageFormRawConfig => isDealStageFormRawConfig(input),
		resolve: raw => ({
			storeId: raw?.storeId ?? '',
			tableId: raw?.tableId ?? '',
			stageInputId: raw?.stageInputId ?? '',
			modalId: raw?.modalId ?? '',
		}),
	})
	.slots({
		fields: { description: 'Deal fields' },
		actions: { description: 'Deal actions' },
	})
	.properties(properties =>
		properties
			.selectedDeal({
				// The consumer refinement narrows Table's generic `Record<string, unknown> | null` down to
				// `Deal | null` (checkpoint §2 dependency skeleton).
				registerDeps: ({ dep, config }) => dep.widget(config.tableId).properties.get('selectedRow')
					.validate((value): value is Deal | null => value === null || isDeal(value)),
				compute: ({ deps }) => {
					const result = deps()
					return result.ok ? result.value : null
				},
			})
			.canSave({
				registerDeps: ({ dep, config }) => ({
					selectedDeal: dep.self.properties.get('selectedDeal'),
					stage: dep.widget(config.stageInputId).state.get('value'),
				}),
				compute: ({ deps }) => {
					const selectedDealResult = deps.selectedDeal()
					const stageResult = deps.stage()
					if (!selectedDealResult.ok || selectedDealResult.value === null)
						return false
					return stageResult.ok && isDealStage(stageResult.value)
				},
			}))
	.methods(methods =>
		methods
			.open({
				registerDeps: ({ dep, config }) => ({
					selectedDeal: dep.self.properties.get('selectedDeal'),
					setStage: dep.widget(config.stageInputId).state.set('value'),
					openModal: dep.widget(config.modalId).methods.invoke('open'),
				}),
				validateArgs: (args): args is [] => args.length === 0,
				execute: ({ deps, addDiagnostic }) => {
					const selectedDealResult = deps.selectedDeal()
					if (!selectedDealResult.ok || selectedDealResult.value === null) {
						addDiagnostic({ message: 'Select a deal before changing its stage.' })
						return
					}
					// `stage-editor` is a generic `SelectInput`; a valid edited Source can omit the
					// selected deal's current stage from its configured options, so this State write can
					// fail. The failing `deps.setStage(...)` call already contributed a method-dependency
					// diagnostic to this invocation's collector — check its result and return before
					// `openModal()` so the Modal never opens with a stale/uninitialized stage-editor value
					// (PR #22 review 4941241562 finding 3).
					const setStageResult = deps.setStage(selectedDealResult.value.stage)
					if (!setStageResult.ok)
						return
					deps.openModal()
				},
			})
			.save({
				registerDeps: ({ dep, config }) => ({
					selectedDeal: dep.self.properties.get('selectedDeal'),
					stage: dep.widget(config.stageInputId).state.get('value')
						.validate(isDealStage),
					updateStage: dep.widget(config.storeId).methods.invoke('updateStage')
						.validate(isDeal),
					closeModal: dep.widget(config.modalId).methods.invoke('close'),
				}),
				validateArgs: (args): args is [] => args.length === 0,
				execute: ({ deps, addDiagnostic }) => {
					const selectedDealResult = deps.selectedDeal()
					if (!selectedDealResult.ok || selectedDealResult.value === null) {
						addDiagnostic({ message: 'save() requires a selected deal.' })
						return DUMMY_DEAL
					}

					const stageResult = deps.stage()
					if (!stageResult.ok)
						return DUMMY_DEAL

					const updateResult = deps.updateStage(selectedDealResult.value.id, stageResult.value)
					if (!updateResult.ok)
						return DUMMY_DEAL

					deps.closeModal()
					return updateResult.value
				},
			})
			.cancel({
				registerDeps: ({ dep, config }) => dep.widget(config.modalId).methods.invoke('close'),
				validateArgs: (args): args is [] => args.length === 0,
				execute: ({ deps }) => {
					deps()
				},
			}))
	.done()
