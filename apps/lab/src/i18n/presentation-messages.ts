import type { LabLocale } from './locale'
import { translateMessage } from './messages'

/**
 * #43 audit of non-tutorial Lab-owned chrome. Keep semantic/source payloads out of this table: plugin
 * types, widget/member ids, file paths, source/Applied JSON, core issues, and config-authored labels are
 * rendered verbatim by their owning inspectors/renderers.
 */
const zhTWPresentationMessages: Readonly<Record<string, string>> = {
	'The declarative definition you edit — changes take effect when you press Apply': '你正在編輯的 declarative definition——按下「套用」後變更才會生效',
	'What the applied Source compiled into — declarations, never live values': '已套用 Source 編譯出的結果——這裡只看 declarations，不是 live values',
	'Live State, Properties, Methods, and Issues of the running widgets': '目前執行中 widgets 的 live State、Properties、Methods 與 Issues',
	'The declared semantic dependencies between widget members': 'widget members 之間已宣告的 semantic dependencies',
	'The Vue presentation of the running widgets — interact here': '執行中 widgets 的 Vue 呈現層——在這裡操作',
	'The plugin + Vue renderer code behind the focused widget type — readonly, curated, never a filesystem/editor': '目前聚焦 widget type 背後的 plugin + Vue renderer 程式碼——唯讀、經整理，不是檔案系統或編輯器',

	'Selected node': '選取的節點',
	'All issues': '所有問題',
	'Runtime unavailable — the applied Blueprint is invalid, so there is nothing running yet. Open the Blueprint tab to see why, fix Source, then Apply again.': 'Runtime 無法使用——已套用的 Blueprint 無效，因此目前沒有可執行內容。請到 Blueprint 查看原因、修正 Source，再重新套用。',
	'Show absent references': '顯示缺少的 references',
	'Show isolated members': '顯示孤立 members',
	'Fit graph': '縮放至完整圖形',
	'Laying out…': '正在排列圖形…',
	'Layout failed — the ELK layout worker reported an error. Toggling a filter below re-requests a fresh layout.': '排列失敗——ELK layout worker 回報錯誤。切換下方任一篩選條件即可重新要求排列。',
	'No graph yet — this Blueprint has no widgets to lay out.': '目前沒有 graph——這個 Blueprint 沒有可排列的 widgets。',
	'Legend': '圖例',
	'Graph legend': 'Graph 圖例',
	'Widget member': 'Widget member',
	'One node per declared State / Property / Method. Identity is widgetId + member kind + member name.': '每個已宣告的 State / Property / Method 各是一個節點。Identity 為 widgetId + member kind + member name。',
	'Reads': '讀取',
	'Read dependency: State/Property access, or a transitively read-only Method invocation from a Property.': '讀取 dependency：State / Property 存取，或 Property 呼叫 transitively read-only Method。',
	'Writes': '寫入',
	'Write dependency: a Method writes State.': '寫入 dependency：Method 寫入 State。',
	'Invokes': '呼叫',
	'Method invocation dependency.': 'Method invocation dependency。',
	'Dashed gray': '灰色虛線',
	'Optional dependency whose target is absent. Hidden unless “Show absent references” is enabled.': 'Optional dependency 的 target 不存在。只有啟用「顯示缺少的 references」時才會顯示。',
	'Dashed red': '紅色虛線',
	'Invalid/unresolved dependency. Always shown.': '無效或無法解析的 dependency。永遠顯示。',
	'Only projected facts from the applied Blueprint are shown — no Runtime reads/evaluation.': '只顯示已套用 Blueprint 的 projected facts——不會讀取或執行 Runtime。',
	'invalid cycle': '無效循環',
	'target': '目標',
	'path': '路徑',
	'(root)': '（根節點）',

	'Inspect': '檢視',
	'Click a widget to focus it in Blueprint — Esc to exit': '點選 widget 以在 Blueprint 聚焦——按 Esc 離開',
	'View implementation': '查看實作',
	'Preview unavailable — the current Blueprint is invalid. See the Blueprint tab for diagnostics.': 'Preview 無法使用——目前 Blueprint 無效。請到 Blueprint 查看 diagnostics。',

	'No widget is focused. Select a widget in Preview (Inspect mode), Blueprint, or Graph to see its implementation here.': '目前沒有聚焦的 widget。請從 Preview（檢視模式）、Blueprint 或 Graph 選取 widget，即可在這裡查看實作。',
	'has no curated Implementation entry yet.': '目前沒有經整理的 Implementation 項目。',
	'Applied instance': '已套用 instance',
	"This widget's declaration was not found in the applied Source — it may only exist in the unapplied draft, or the applied Blueprint changed since this focus was set.": '在已套用 Source 中找不到這個 widget declaration——它可能只存在於尚未套用的 draft，或聚焦後已套用 Blueprint 發生變更。',
	'Copy': '複製',
	'Copied': '已複製',
	'Copy failed': '複製失敗',
	'Loading…': '載入中…',
	'Failed to render this source.': '無法顯示這份 source。',

	// Representative renderer-owned chrome from the Survey showcase. Source/config-authored labels and
	// issue messages intentionally stay verbatim; only fixed renderer prose/labels belong here.
	'Illustrative/demo estimate only — synthetic Lab fixtures, not real travel pricing.': '僅供示範的估算——使用合成 Lab fixtures，不代表真實旅遊價格。',
	'Trip days': '旅遊天數',
	'Travelers': '旅客數',
	'Budget / person / day': '每人每日預算',
	'Estimated baseline cost': '預估基本花費',
	'Unavailable': '無法使用',
}

export function translatePresentationMessage(locale: LabLocale, source: string): string {
	if (locale === 'zh-TW') {
		const translated = zhTWPresentationMessages[source]
		if (translated !== undefined)
			return translated
	}
	return translateMessage(locale, source)
}
