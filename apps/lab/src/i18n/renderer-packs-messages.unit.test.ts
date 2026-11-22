/**
 * The Lab-side zh-TW text of the "One document, two renderer packs" showcase: the Examples menu entries (the showcase and its
 * presets). The tutorial strings are checked against the script in `tutorial/renderer-packs-script.unit.test.ts`, and the
 * showcase's own text lives in the showcase (`showcases/renderer-packs/messages.ts`). This file lives here, not in the showcase,
 * because it reads the Lab's i18n tables, which a showcase must not import. Every literal of the showcase's own table has a zh-TW
 * counterpart with the same `{markers}`.
 */

import { describe, expect, it } from 'vitest'
import { packsMessages } from '../showcases/renderer-packs/messages'
import { packsPresets } from '../showcases/renderer-packs/presets'
import { rendererPacksTourScript } from '../tutorial/renderer-packs-script'
import { translateMessage } from './messages'
import { translatePresentationMessage } from './presentation-messages'
import { zhTWRendererPacksMessages } from './renderer-packs-messages'

describe('renderer packs Examples menu text', () => {
	it('has a zh-TW label and description for every preset (the Examples menu translates them)', () => {
		for (const preset of packsPresets) {
			expect(translatePresentationMessage('zh-TW', preset.label), preset.label)
				.not
				.toBe(preset.label)
			expect(translatePresentationMessage('zh-TW', preset.description), preset.id)
				.not
				.toBe(preset.description)
		}
	})

	it('names the showcase in zh-TW and leaves English as written', () => {
		expect(translatePresentationMessage('zh-TW', 'One document, two renderer packs'))
			.toBe('一份文件，兩組 renderer pack')
		expect(translateMessage('en', 'One document, two renderer packs'))
			.toBe('One document, two renderer packs')
	})

	it('translates nothing the showcase or its tour does not use (no stale entries)', () => {
		const used = new Set<string>(['One document, two renderer packs', 'Starting the tutorial will load the Renderer packs teaching example and replace your unapplied changes.'])
		for (const preset of packsPresets) {
			used.add(preset.label)
			used.add(preset.description)
		}
		for (const step of rendererPacksTourScript.steps) {
			used.add(step.title)
			for (const { prompt, reveal } of step.stages) {
				used.add(prompt)
				used.add(reveal)
			}
			for (const link of step.links ?? [])
				used.add(link.label)
		}
		expect(Object.keys(zhTWRendererPacksMessages)
			.filter(source => !used.has(source)))
			.toEqual([])
	})
})

describe('the showcase\'s own messages', () => {
	it('has every key in both locales, and keeps the same {markers} in each', () => {
		expect(Object.keys(packsMessages['zh-TW']))
			.toEqual(Object.keys(packsMessages.en))
		const markers = (value: string): string[] => [...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]!)
			.sort()
		for (const key of Object.keys(packsMessages.en) as (keyof typeof packsMessages.en)[]) {
			expect(markers(packsMessages['zh-TW'][key]), key)
				.toEqual(markers(packsMessages.en[key]))
			expect(packsMessages['zh-TW'][key], key)
				.not
				.toBe('')
			expect(packsMessages['zh-TW'][key], key)
				.not
				.toBe(packsMessages.en[key])
		}
	})

	it('writes the zh-TW text in Taiwan Traditional Chinese (no Simplified-only characters or Mainland terms)', () => {
		const text = [...Object.values(packsMessages['zh-TW']), ...Object.values(zhTWRendererPacksMessages)]
			.join('\n')
		for (const simplified of ['软', '据', '创', '户', '设', '这', '们', '读', '软件', '默认', '信息', '文件夹', '渲染', '组件', '界面'])
			expect(text, simplified).not.toContain(simplified)
	})
})
