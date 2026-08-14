/**
 * `Button.press`/`Modal.open`/`Modal.close` (checkpoint §2), against the real canonical preset
 * (`../presets.ts`). Covers `Button.press()` invoking its configured target and propagating target
 * failure as an ordinary method-dependency failure, `Modal`'s own open/close State/Methods, and the
 * "closed modal's semantic subtree stays callable" proof: `Button#change-stage`'s configured target
 * (`deal-stage-form.open`) succeeds and flips `Modal#stage-modal.open` to `true` even though the Modal
 * — and therefore, in the real Vue tree, its entire `body` slot subtree including `DealStageForm` — is
 * closed/unmounted at the moment the Button is pressed (checkpoint §3).
 */

import { describe, expect, it } from 'vitest'
import { createCrmRuntime, widgetOfType } from '../test-support'

function setup() {
	const { runtime } = createCrmRuntime()
	return {
		runtime,
		resetButton: widgetOfType(runtime, 'reset-data', 'Button'),
		changeStageButton: widgetOfType(runtime, 'change-stage', 'Button'),
		saveButton: widgetOfType(runtime, 'save-stage', 'Button'),
		cancelButton: widgetOfType(runtime, 'cancel-stage', 'Button'),
		table: widgetOfType(runtime, 'deal-table', 'Table'),
		modal: widgetOfType(runtime, 'stage-modal', 'Modal'),
		store: widgetOfType(runtime, 'deal-store', 'DealStore'),
	}
}

describe('button.press() — invokes its configured target', () => {
	it('reset-data invokes DealStore.reset()', () => {
		const { resetButton, store } = setup()
		store.methods.updateStage('deal-1', 'won')
		expect(store.state.deals.get()!.find(deal => deal.id === 'deal-1')?.stage)
			.toBe('won')

		expect(resetButton.methods.press())
			.toEqual({ success: true, value: undefined })
		expect(store.state.deals.get()!.find(deal => deal.id === 'deal-1')?.stage)
			.toBe('lead')
	})

	it('change-stage invokes DealStageForm.open(), which opens the Modal — while the Modal (and its body subtree) is closed at press time', () => {
		const { changeStageButton, table, modal } = setup()
		table.methods.selectRow('deal-1')
		expect(modal.state.open.get())
			.toBe(false)

		const result = changeStageButton.methods.press()

		expect(result)
			.toEqual({ success: true, value: undefined })
		expect(modal.state.open.get())
			.toBe(true)
	})

	it('propagates its target\'s failure as an ordinary method-dependency failure', () => {
		const { changeStageButton, modal } = setup()
		// No deal selected — DealStageForm.open() fails.
		const result = changeStageButton.methods.press()
		expect(result.success)
			.toBe(false)
		if (result.success)
			throw new Error('expected a failure')
		expect(result.issues[0]!.source.type)
			.toBe('method-dependency')
		expect(modal.state.open.get())
			.toBe(false)
	})

	it('save-stage and cancel-stage invoke DealStageForm.save()/cancel()', () => {
		const { changeStageButton, saveButton, cancelButton, table, modal } = setup()
		table.methods.selectRow('deal-2')
		changeStageButton.methods.press()
		expect(modal.state.open.get())
			.toBe(true)

		expect(cancelButton.methods.press())
			.toEqual({ success: true, value: undefined })
		expect(modal.state.open.get())
			.toBe(false)

		changeStageButton.methods.press()
		expect(saveButton.methods.press().success)
			.toBe(true)
		expect(modal.state.open.get())
			.toBe(false)
	})
})

describe('modal.open() / close()', () => {
	it('flip the open State directly', () => {
		const { modal } = setup()
		expect(modal.state.open.get())
			.toBe(false)

		expect(modal.methods.open())
			.toEqual({ success: true, value: undefined })
		expect(modal.state.open.get())
			.toBe(true)

		expect(modal.methods.close())
			.toEqual({ success: true, value: undefined })
		expect(modal.state.open.get())
			.toBe(false)
	})
})
