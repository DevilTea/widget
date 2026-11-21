/**
 * Legacy document repair: the pure, framework-free domain of the showcase. Nothing here runs a Runtime.
 *
 * **Migration and repair are this application's policy, not Core's.** Core does not migrate, version, repair or
 * quarantine a stored document: it compiles whatever it is given, says exactly where the problems are (diagnostics and
 * `blueprint.getSourcePath(node)`) and applies the `SourcePatch` the host sends. Which patch repairs which legacy shape is
 * a decision of the notice-board app, so it is written here, as `planRepair`: an ordered list of steps, each a
 * `SourcePatch` whose first operations are `test` guards for the precondition the step was planned against. A shape that
 * the application has no rule for gets no step, and the document stays invalid (Core creates no Runtime for it).
 *
 * Nothing is persisted: the "stored" drafts are in-memory fixtures (`./fixtures.ts`).
 */

import type { SourcePatch, SourcePatchOperation } from '@deviltea/widget-core'
import { isJsonValue } from '@deviltea/widget-core'

// -------------------------------------------------------------------------------------------------
// Text
// -------------------------------------------------------------------------------------------------

/** Text per language, `{ "en": "...", "zh-TW": "..." }`. `en` is required; a missing language falls back to it. */
export interface I18nText { readonly [language: string]: string }

/** The text in `language`, or the English text when that language is missing. */
export function localize(text: I18nText, language: string): string {
	return Object.hasOwn(text, language) && typeof text[language] === 'string' && text[language] !== ''
		? text[language]
		: text.en ?? ''
}

/** Fills `{name}` placeholders. A placeholder without a value stays as written. */
export function fill(template: string, values: Readonly<Record<string, string | number>>): string {
	return template.replace(/\{(\w+)\}/g, (whole, key: string) => Object.hasOwn(values, key) ? String(values[key]) : whole)
}

export function isRecord(input: unknown): input is Record<string, unknown> {
	return typeof input === 'object' && input !== null && !Array.isArray(input)
}

export function isI18nText(input: unknown): input is I18nText {
	return isRecord(input) && typeof input.en === 'string' && Object.values(input)
		.every(value => typeof value === 'string')
}

/** A short description of a value for a message ("a string", "null", "an array"). */
export function describeValue(input: unknown): string {
	if (input === null)
		return 'null'
	if (Array.isArray(input))
		return 'an array'
	if (typeof input === 'string')
		return `the string ${JSON.stringify(input)}`
	if (typeof input === 'number' || typeof input === 'boolean')
		return `the ${typeof input} ${String(input)}`
	return `a(n) ${typeof input}`
}

// -------------------------------------------------------------------------------------------------
// Versions and dates
// -------------------------------------------------------------------------------------------------

/** The format versions a draft can have been saved with. `3.x` is the current notice-board format. */
export const SAVED_WITH_VERSIONS = ['1.x', '2.x', '3.x'] as const
export type SavedWith = typeof SAVED_WITH_VERSIONS[number]

export const CURRENT_APP_VERSION = '3.0'

export function isSavedWith(input: unknown): input is SavedWith {
	return typeof input === 'string' && (SAVED_WITH_VERSIONS as readonly string[]).includes(input)
}

export const TONES = ['info', 'warning'] as const
export type Tone = typeof TONES[number]

export function isTone(input: unknown): input is Tone {
	return typeof input === 'string' && (TONES as readonly string[]).includes(input)
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/** `true` for a real calendar date written `YYYY-MM-DD` (`2026-02-30` is not one). */
export function isIsoDate(input: unknown): input is string {
	if (typeof input !== 'string' || !ISO_DATE_PATTERN.test(input))
		return false
	const [year, month, day] = input.split('-')
		.map(Number) as [number, number, number]
	const date = new Date(Date.UTC(year, month - 1, day))
	return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

/** A `YYYY-MM-DD` date (UTC) for an epoch-milliseconds number, or `null` when the value is not a number that names a date. */
export function epochToDate(milliseconds: unknown): string | null {
	if (typeof milliseconds !== 'number' || !Number.isFinite(milliseconds) || Math.abs(milliseconds) > 8.64e15)
		return null
	const date = new Date(milliseconds)
		.toISOString()
		.slice(0, 10)
	return isIsoDate(date) ? date : null
}

/** A date such as `2026-12-05` in the viewer's language, always read in UTC so the viewer's time zone never moves it. */
export function formatDate(date: string, locale: string): string {
	if (!isIsoDate(date))
		return date
	return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' })
		.format(new Date(`${date}T00:00:00Z`))
}

// -------------------------------------------------------------------------------------------------
// Source paths
// -------------------------------------------------------------------------------------------------

export type PathSegment = string | number

/** A structured source path as a JSON Pointer (RFC 6901) for display: `['slots', 'items', 0]` is `/slots/items/0`, `[]` is `/`. */
export function formatPointer(path: readonly PathSegment[]): string {
	return path.length === 0
		? '/'
		: path.map(segment => `/${String(segment)
				.replaceAll('~', '~0')
				.replaceAll('/', '~1')}`)
				.join('')
}

// -------------------------------------------------------------------------------------------------
// What Core says about a stored draft (the `findings` Property, `./plugins/findings.ts`)
// -------------------------------------------------------------------------------------------------

export interface FindingDiagnostic {
	readonly code: string
	readonly message: string
	/** Where the diagnostic's node sits in the source (`blueprint.getSourcePath`), or the diagnostic's own path for a source-level one. */
	readonly sourcePath: readonly PathSegment[] | null
	readonly reason?: string
}

export interface FindingSlot {
	readonly name: string
	/** `raw-slot`: the source has a slot key the plugin does not declare. Its children are still recovered, and still invalid until moved. */
	readonly placement: 'slot' | 'raw-slot'
	readonly children: number
}

export interface FindingNode {
	readonly sourcePath: readonly PathSegment[]
	readonly resolved: boolean
	/** The authored `id`/`type` when they are strings (an unresolved node still carries these hints). */
	readonly id: string | null
	readonly type: string | null
	readonly slots: readonly FindingSlot[]
}

export interface Findings {
	readonly status: 'valid' | 'invalid'
	readonly sourceJsonCompatible: boolean
	readonly diagnostics: readonly FindingDiagnostic[]
	readonly nodes: readonly FindingNode[]
}

// -------------------------------------------------------------------------------------------------
// The migration plan
// -------------------------------------------------------------------------------------------------

export interface RepairStep {
	readonly id: string
	readonly title: I18nText
	/** Why the application repairs it this way. */
	readonly why: I18nText
	/** The patch to send. Its first operations are `test` guards for the precondition the step was planned against. */
	readonly patch: SourcePatch
}

const LEGACY_NOTICE_TYPES: readonly unknown[] = ['Banner', 'Notice']

function guard(path: readonly PathSegment[], value: unknown): SourcePatchOperation {
	return { op: 'test', path, value: value as never }
}

/** The path of a child of the Board's `notices` slot, `index` being its position in the array. */
function at(index: number, ...rest: PathSegment[]): readonly PathSegment[] {
	return ['slots', 'notices', index, ...rest]
}

interface Child {
	readonly index: number
	readonly node: Record<string, unknown>
	readonly id: string | null
}

/** The `config` of a legacy notice written the way the current format wants it (`text` becomes `body`, an epoch `until` a date). */
export function migrateNoticeConfig(config: unknown): unknown {
	if (!isRecord(config))
		return config
	const next: Record<string, unknown> = {}
	for (const [key, value] of Object.entries(config)) {
		if (key === 'text' && !Object.hasOwn(config, 'body'))
			next.body = value
		else if (key === 'until' && epochToDate(value) !== null)
			next.until = epochToDate(value)
		else
			next[key] = value
	}
	return next
}

/**
 * The application's repair plan for a draft saved with `savedWith`, read from its current `source`: an ordered list of steps,
 * each a `SourcePatch` that applies to the source as it is **after the steps before it**. It is a pure function of the source,
 * so the plan is computed again from the current snapshot after every commit (and when another editor changed the document).
 *
 * The rules, by the version they repair:
 * - `1.x`: the notices lived in a slot called `items` (`rename-slot`: Core reports an undeclared slot and keeps the children
 *   as a `raw-slot` placement), were of type `Banner` (`rename-type`: an unknown type is an unresolved node), kept their text in
 *   `config.text` (`rename-config-text`), carried a `style` field on the widget itself (`move-style`: Core reports
 *   `unexpected-widget-field`; `meta` is the host's place and Core never interprets it), could share an id (`fix-duplicate-ids`)
 *   or have none (`rewrite-no-id`: such a node is unresolved and nothing addresses it, so the whole array element is replaced);
 * - `1.x` and `2.x`: `until` was sometimes an epoch-milliseconds number (`convert-until`, a config diagnostic);
 * - `3.x`: the current format, nothing to repair.
 *
 * Anything the application has no rule for (an unknown type such as `Poll`, say) gets no step: the repaired document is
 * still invalid, and Core still creates no Runtime for it. A source that is not JSON has no step either: a patch operand must
 * be a JSON value, and Core would refuse every step with `json-incompatible-value`, so planning it would never converge.
 */
export function planRepair(source: unknown, savedWith: SavedWith): readonly RepairStep[] {
	if (savedWith === '3.x' || !isJsonValue(source) || !isRecord(source) || !isRecord(source.slots))
		return []
	const slots = source.slots
	const legacy = savedWith === '1.x'
	const renameSlot = legacy && Array.isArray(slots.items) && !Object.hasOwn(slots, 'notices')
	const list: unknown = Array.isArray(slots.notices) ? slots.notices : (renameSlot ? slots.items : null)
	if (!Array.isArray(list))
		return []

	const steps: RepairStep[] = []
	if (renameSlot) {
		steps.push({
			id: 'rename-slot',
			title: { 'en': 'Move the notices from the old "items" slot to "notices"', 'zh-TW': '把公告從舊的「items」slot 搬到「notices」' },
			why: { 'en': 'Version 1 called the Board\'s slot "items". Core reports an undeclared slot and keeps its children as a raw-slot placement; moving the whole array keeps them in order.', 'zh-TW': '1.x 版把 Board 的 slot 叫做「items」。Core 會回報未宣告的 slot，並把底下的子節點保留為 raw-slot 位置；整個陣列一起搬過去，順序不變。' },
			patch: [guard(['slots', 'items'], slots.items), { op: 'move', from: ['slots', 'items'], path: ['slots', 'notices'] }],
		})
	}

	const children: Child[] = []
	list.forEach((node: unknown, index) => {
		if (isRecord(node))
			children.push({ index, node, id: typeof node.id === 'string' ? node.id : null })
	})
	const identified = children.filter(child => child.id !== null)

	if (legacy) {
		const renames = identified.filter(child => child.node.type === 'Banner')
		if (renames.length > 0) {
			steps.push({
				id: 'rename-type',
				title: { 'en': 'Rename the type "Banner" to "Notice"', 'zh-TW': '把類型「Banner」改名為「Notice」' },
				why: { 'en': 'Version 1 called a notice a Banner. Core reports an unknown type as an unresolved node that keeps its id and type as hints; only the application knows the plugin was renamed.', 'zh-TW': '1.x 版把公告叫做 Banner。Core 會把未知類型回報成未解析的節點（仍保留 id 與 type 作為提示）；只有應用程式知道這個 plugin 已經改名。' },
				patch: renames.flatMap((child): SourcePatchOperation[] => [guard(at(child.index, 'type'), 'Banner'), { op: 'replace', path: at(child.index, 'type'), value: 'Notice' }]),
			})
		}

		const texts = identified.filter(child => LEGACY_NOTICE_TYPES.includes(child.node.type) && isRecord(child.node.config) && typeof child.node.config.text === 'string' && !Object.hasOwn(child.node.config, 'body'))
		if (texts.length > 0) {
			steps.push({
				id: 'rename-config-text',
				title: { 'en': 'Rename the config key "text" to "body"', 'zh-TW': '把 config 的鍵「text」改名為「body」' },
				why: { 'en': 'The notice config renamed "text" to "body". Its checker rejects an unknown key, so the value moves to the new key.', 'zh-TW': '公告的 config 把「text」改名為「body」。它的檢查會拒絕未知的鍵，所以把值搬到新的鍵。' },
				patch: texts.flatMap((child): SourcePatchOperation[] => [guard(at(child.index, 'config', 'text'), (child.node.config as Record<string, unknown>).text), { op: 'move', from: at(child.index, 'config', 'text'), path: at(child.index, 'config', 'body') }]),
			})
		}

		const styled = identified.filter(child => Object.hasOwn(child.node, 'style') && (Object.hasOwn(child.node, 'meta') ? isRecord(child.node.meta) && !Object.hasOwn(child.node.meta, 'style') : true))
		if (styled.length > 0) {
			steps.push({
				id: 'move-style',
				title: { 'en': 'Move the widget field "style" into meta.style', 'zh-TW': '把 widget 欄位「style」搬進 meta.style' },
				why: { 'en': 'A widget node may only have id, type, config, slots and meta: any other own key is unexpected-widget-field. "meta" is the host\'s place, so the style is kept there and Core never interprets it.', 'zh-TW': 'widget 節點只能有 id、type、config、slots 與 meta；任何其他欄位都是 unexpected-widget-field。「meta」是 host 自己的地方，樣式就留在那裡，Core 不會解讀它。' },
				patch: styled.flatMap((child): SourcePatchOperation[] => {
					const operations: SourcePatchOperation[] = [guard(at(child.index, 'style'), child.node.style)]
					if (!Object.hasOwn(child.node, 'meta'))
						operations.push({ op: 'add', path: at(child.index, 'meta'), value: {} })
					operations.push({ op: 'move', from: at(child.index, 'style'), path: at(child.index, 'meta', 'style') })
					return operations
				}),
			})
		}

		// The first node with an id keeps it; a later one (or one that repeats the root's id) is renamed.
		const taken = new Set<string>(typeof source.id === 'string' ? [source.id] : [])
		const everyId = new Set<string>([...taken, ...identified.map(child => child.id as string)])
		const duplicates: SourcePatchOperation[] = []
		for (const child of identified) {
			const id = child.id as string
			if (!taken.has(id)) {
				taken.add(id)
				continue
			}
			let suffix = 2
			while (everyId.has(`${id}-${suffix}`))
				suffix++
			const renamed = `${id}-${suffix}`
			everyId.add(renamed)
			taken.add(renamed)
			duplicates.push(guard(at(child.index, 'id'), id), { op: 'replace', path: at(child.index, 'id'), value: renamed })
		}
		if (duplicates.length > 0) {
			steps.push({
				id: 'fix-duplicate-ids',
				title: { 'en': 'Give a repeated id a new one', 'zh-TW': '為重複的 id 換一個新的' },
				why: { 'en': 'An id must be unique in the tree, and Core reports duplicate-widget-id on every occurrence. The application keeps the first and renames the later ones; which one to keep is its decision.', 'zh-TW': 'id 在整棵樹中必須唯一，Core 會在每一個重複處回報 duplicate-widget-id。應用程式保留第一個、重新命名後面的；要留哪一個由它決定。' },
				patch: duplicates,
			})
		}

		const unidentified = children.filter(child => child.id === null && LEGACY_NOTICE_TYPES.includes(child.node.type))
		if (unidentified.length > 0) {
			let counter = 1
			steps.push({
				id: 'rewrite-no-id',
				title: { 'en': 'Replace a notice that has no id with a complete one', 'zh-TW': '把沒有 id 的公告整個換成完整的' },
				why: { 'en': 'A node without an id is unresolved: nothing can address it, and every other field of it is still the old shape. This is the repair floor: the whole array element is replaced, with an id the application makes up and the old content carried over.', 'zh-TW': '沒有 id 的節點是未解析的：沒有東西能指到它，而且它的其他欄位也都還是舊的格式。這是修復的底線：整個陣列元素一起換掉，由應用程式編一個 id，並把舊內容帶過去。' },
				patch: unidentified.flatMap((child): SourcePatchOperation[] => {
					while (everyId.has(`notice-${counter}`))
						counter++
					const id = `notice-${counter}`
					everyId.add(id)
					// A legacy notice without a `config` gets none: there is nothing to carry over and the application does not invent
					// a headline, a text or a date, so the notice stays invalid (and has an id now, so no step plans it again).
					const next: Record<string, unknown> = { id, type: 'Notice' }
					if (child.node.config !== undefined)
						next.config = migrateNoticeConfig(child.node.config)
					if (isRecord(child.node.meta) || child.node.style !== undefined)
						next.meta = { ...(isRecord(child.node.meta) ? child.node.meta : {}), ...(child.node.style === undefined ? {} : { style: child.node.style }) }
					return [guard(at(child.index), child.node), { op: 'replace', path: at(child.index), value: next as never }]
				}),
			})
		}
	}

	const dated = identified.filter(child => isRecord(child.node.config) && epochToDate(child.node.config.until) !== null)
	if (dated.length > 0) {
		steps.push({
			id: 'convert-until',
			title: { 'en': 'Write "until" as a date instead of epoch milliseconds', 'zh-TW': '把「until」從 epoch 毫秒改成日期' },
			why: { 'en': 'Versions 1 and 2 sometimes stored "until" as a number of milliseconds. The notice config accepts only a YYYY-MM-DD date and reports anything else as a located config diagnostic, so the value is replaced (in UTC).', 'zh-TW': '1.x 與 2.x 有時把「until」存成毫秒數。公告的 config 只接受 YYYY-MM-DD 日期，其他值都會回報成有位置的 config 診斷，所以把值換掉（以 UTC 計）。' },
			patch: dated.flatMap((child): SourcePatchOperation[] => {
				const until = (child.node.config as Record<string, unknown>).until
				return [guard(at(child.index, 'config', 'until'), until), { op: 'replace', path: at(child.index, 'config', 'until'), value: epochToDate(until) as string }]
			}),
		})
	}

	return steps
}
