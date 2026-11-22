/**
 * The Lab-side zh-TW text of the Legacy document repair showcase: the Examples menu entries (the showcase and its presets).
 * The tutorial strings are checked against the script in `tutorial/document-repair-script.unit.test.ts`, and the showcase's own
 * text lives in the showcase (`showcases/document-repair/messages.ts`). This file lives here, not in the showcase, because it
 * reads the Lab's i18n tables, which a showcase must not import. Every literal of the showcase's own table has a zh-TW
 * counterpart with the same `{markers}`.
 */

import { describe, expect, it } from 'vitest'
import { ALERT_MESSAGE_KEYS, repairMessages } from '../showcases/document-repair/messages'
import { repairPresets } from '../showcases/document-repair/presets'
import { documentRepairTourScript } from '../tutorial/document-repair-script'
import { zhTWDocumentRepairMessages } from './document-repair-messages'
import { translateMessage } from './messages'
import { translatePresentationMessage } from './presentation-messages'

describe('document repair Examples menu text', () => {
	it('has a zh-TW label and description for every preset (the Examples menu translates them)', () => {
		for (const preset of repairPresets) {
			expect(translatePresentationMessage('zh-TW', preset.label), preset.label)
				.not
				.toBe(preset.label)
			expect(translatePresentationMessage('zh-TW', preset.description), preset.id)
				.not
				.toBe(preset.description)
		}
	})

	it('names the showcase in zh-TW and leaves English as written', () => {
		expect(translatePresentationMessage('zh-TW', 'Legacy document repair'))
			.toBe('舊版文件修復')
		expect(translateMessage('en', 'Legacy document repair'))
			.toBe('Legacy document repair')
	})

	it('translates nothing the showcase or its tour does not use (no stale entries)', () => {
		const used = new Set<string>(['Legacy document repair', 'Starting the tutorial will load the Legacy document repair teaching example and discard the JSON that can\'t be applied yet.'])
		for (const preset of repairPresets) {
			used.add(preset.label)
			used.add(preset.description)
		}
		for (const step of documentRepairTourScript.steps) {
			used.add(step.title)
			for (const { prompt, reveal } of step.stages) {
				used.add(prompt)
				used.add(reveal)
			}
			for (const link of step.links ?? [])
				used.add(link.label)
		}
		expect(Object.keys(zhTWDocumentRepairMessages)
			.filter(source => !used.has(source)))
			.toEqual([])
	})
})

describe('the messages that explain a refused patch', () => {
	it('map every Core failure code the page knows (reentrant-apply included) to a message in both locales', () => {
		for (const code of ['document-revision-conflict', 'reentrant-apply', 'test-failed', 'path-not-found', 'invalid-operation']) {
			expect(Object.hasOwn(ALERT_MESSAGE_KEYS, code), code)
				.toBe(true)
		}
		for (const [code, key] of Object.entries(ALERT_MESSAGE_KEYS)) {
			expect(repairMessages.en[key], code)
				.toBeTruthy()
			expect(repairMessages['zh-TW'][key], code)
				.toBeTruthy()
		}
	})

	it('has no message that nothing uses', () => {
		const used = new Set<string>(Object.values(ALERT_MESSAGE_KEYS))
		expect(used.has('alertConflict'))
			.toBe(true)
		expect(Object.hasOwn(repairMessages.en, 'alertGeneric'))
			.toBe(false)
		expect(Object.hasOwn(repairMessages.en, 'storedUntouched'))
			.toBe(false)
	})
})

describe('the showcase\'s own messages', () => {
	it('has every key in both locales, and keeps the same {markers} in each', () => {
		expect(Object.keys(repairMessages['zh-TW']))
			.toEqual(Object.keys(repairMessages.en))
		const markers = (value: string): string[] => [...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]!)
			.sort()
		for (const key of Object.keys(repairMessages.en) as (keyof typeof repairMessages.en)[]) {
			expect(markers(repairMessages['zh-TW'][key]), key)
				.toEqual(markers(repairMessages.en[key]))
			expect(repairMessages['zh-TW'][key], key)
				.not
				.toBe('')
			expect(repairMessages['zh-TW'][key], key)
				.not
				.toBe(repairMessages.en[key])
		}
	})

	it('writes the zh-TW text in Taiwan Traditional Chinese (no Simplified-only characters or Mainland terms)', () => {
		const text = Object.values(repairMessages['zh-TW'])
			.join('\n')
		for (const simplified of ['软', '据', '创', '户', '设', '这', '们', '读', '软件', '默认', '信息', '文件夹'])
			expect(text, simplified).not.toContain(simplified)
	})
})
