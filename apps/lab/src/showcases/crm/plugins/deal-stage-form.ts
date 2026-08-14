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
 * registered dependencies (checkpoint §2) — with no selected deal, it fails via `addIssue` and the
 * Modal never opens. `save()` propagates any `DealStore.updateStage` failure as an ordinary
 * method-dependency failure (no modal close, no fallback mutation); on success it invokes `Modal.close`
 * and returns the updated `Deal`. `cancel()` only closes the Modal — no store mutation.
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
	.interfaces<DealStageFormInterfaces>()
	.config({
		validate: (input): input is DealStageFormRawConfig => isDealStageFormRawConfig(input),
		resolve: raw => ({
			storeId: raw?.storeId ?? '',
			tableId: raw?.tableId ?? '',
			stageInputId: raw?.stageInputId ?? '',
			modalId: raw?.modalId ?? '',
		}),
	})
	.slots({ fields: {}, actions: {} })
	.properties(properties =>
		properties
			.selectedDeal({
				// The consumer refinement narrows Table's generic `Record<string, unknown> | null` down to
				// `Deal | null` (checkpoint §2 dependency skeleton).
				registerDeps: ({ dep, config }) => dep.widget(config.tableId).properties.get('selectedRow')
					.validate((value): value is Deal | null => value === null || isDeal(value)),
				compute: ({ deps }) => {
					const result = deps()
					return result.success ? result.value : null
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
					if (!selectedDealResult.success || selectedDealResult.value === null)
						return false
					return stageResult.success && isDealStage(stageResult.value)
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
				execute: ({ deps, addIssue }) => {
					const selectedDealResult = deps.selectedDeal()
					if (!selectedDealResult.success || selectedDealResult.value === null) {
						addIssue({ message: 'Select a deal before changing its stage.' })
						return
					}
					deps.setStage(selectedDealResult.value.stage)
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
				execute: ({ deps, addIssue }) => {
					const selectedDealResult = deps.selectedDeal()
					if (!selectedDealResult.success || selectedDealResult.value === null) {
						addIssue({ message: 'save() requires a selected deal.' })
						return DUMMY_DEAL
					}

					const stageResult = deps.stage()
					if (!stageResult.success)
						return DUMMY_DEAL

					const updateResult = deps.updateStage(selectedDealResult.value.id, stageResult.value)
					if (!updateResult.success)
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
