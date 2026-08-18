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
	'No issues.': '沒有問題。',
	'jump to node': '跳到節點',
	'No node selected — click a node in the tree on the left to see its config, slots, and issues.': '尚未選取節點——點選左側 tree 的節點即可查看 config、slots 與 issues。',
	'Unresolved node': '未解析節點',
	'status': '狀態',
	'location': '位置',
	'parent': 'parent',
	'index': 'index',
	'(unresolved parent)': '（未解析 parent）',
	'Config': 'Config',
	'No config capability.': '沒有 config capability。',
	'Semantic slots': 'Semantic slots',
	'child(ren)': '個子節點',
	'Slots capability present, but declares no slot names (e.g. explicit-empty': 'Slots capability 存在，但沒有宣告任何 slot 名稱（例如 explicit-empty',
	').': '）。',
	'No slots capability.': '沒有 slots capability。',
	'Members': 'Members',
	'Raw definition': 'Raw definition',
	'Issues': 'Issues',

	'Runtime unavailable — the applied Blueprint is invalid, so there is nothing running yet. Open the Blueprint tab to see why, fix Source, then Apply again.': 'Runtime 無法使用——已套用的 Blueprint 無效，因此目前沒有可執行內容。請到 Blueprint 查看原因、修正 Source，再重新套用。',
	'No node selected — click a node in the tree on the left to see its live State, Properties, and Methods.': '尚未選取節點——點選左側 tree 的節點即可查看 live State、Properties 與 Methods。',
	'No State members.': '沒有 State members。',
	'No Property members.': '沒有 Property members。',
	'inventory only': '僅列出清單',
	'No Method members.': '沒有 Method members。',
	'Never evaluated': '尚未求值',
	'Failed ({count} {issueWord})': '失敗（{count} 個{issueWord}）',
	'show issues': '顯示 issues',
	'hide issues': '隱藏 issues',

	'Show absent references': '顯示缺少的 references',
	'Show isolated members': '顯示孤立 members',
	'Fit graph': '縮放至完整圖形',
	'Laying out…': '正在排列圖形…',
	'Layout failed — the ELK layout worker reported an error. Toggling a filter below re-requests a fresh layout.': '排列失敗——ELK layout worker 回報錯誤。切換下方任一篩選條件即可重新要求排列。',
	'No graph yet — this Blueprint has no widgets to lay out.': '目前沒有 graph——這個 Blueprint 沒有可排列的 widgets。',
	'Legend': '圖例',
	'Graph legend': 'Graph 圖例',
	'Widgets and members': 'Widgets 與 members',
	'Widget cluster — labeled': 'Widget cluster——標示為',
	'Method — a "W" badge means it transitively writes State': 'Method——「W」標記表示它會 transitively 寫入 State',
	'Any member in an invalid evaluation cycle (overrides its own kind color)': '任何位於無效 evaluation cycle 的 member（會覆蓋自身 kind 顏色）',
	'Edges (owner → what it depends on)': 'Edges（owner → 它所依賴的項目）',
	'a State or Property read': '一次 State 或 Property 讀取',
	'a State write (Method-only)': '一次 State 寫入（僅 Method）',
	'a Method invocation': '一次 Method 呼叫',
	'The label is the only thing distinguishing edge kinds today — edge color is not yet meaningful.': '目前只有 label 用來區分 edge kinds——edge color 尚未具有語意。',
	'Stubs (a dependency with no resolved target)': 'Stubs（沒有 resolved target 的 dependency）',
	'Absent — hidden unless "Show absent references" is on': 'Absent——除非開啟「顯示缺少的 references」，否則隱藏',
	'Invalid — always shown': 'Invalid——永遠顯示',
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
	'This widget\'s declaration was not found in the applied Source — it may only exist in the unapplied draft, or the applied Blueprint changed since this focus was set.': '在已套用 Source 中找不到這個 widget declaration——它可能只存在於尚未套用的 draft，或聚焦後已套用 Blueprint 發生變更。',
	'Copy': '複製',
	'Copied': '已複製',
	'Copy failed': '複製失敗',
	'Loading…': '載入中…',
	'Loading {title}…': '正在載入 {title}…',
	'Failed to load {title}.': '無法載入 {title}。',
	'Failed to render this source.': '無法顯示這份 source。',

	// CRM renderer-owned fixed chrome. Config-projected Button/TextInput/Table/MetricCard labels and all
	// deal/stage/series values intentionally stay outside this table even when their English text looks UI-like.
	'Sales Pipeline CRM': '銷售案件 CRM',
	'Interactive Product Prototype — Showcase B': '互動式產品原型——Showcase B',
	'Deals by stage': '各階段案件數',
	'Deal details': '案件詳細資料',
	'Select a deal from the table to see its details.': '從表格選取案件以查看詳細資料。',
	'currently': '目前為',
	'No deal selected.': '尚未選取案件。',
	'Change deal stage': '變更案件階段',
	'No deals match the current search/filter.': '沒有符合目前搜尋／篩選條件的案件。',

	// Survey renderer-owned fixed chrome. Question labels/help/options and result payload values/notes are
	// semantic/config data and deliberately stay verbatim.
	'Interactive Survey — trip planner': '互動式問卷——旅遊規劃',
	'phase': '階段',
	'Reset': '重設',
	'Submit': '提交',
	'Generate result': '產生結果',
	'Recommendation': '建議結果',
	'Stale': '已過期',
	'Generated from previous answers — this recommendation does not reflect the current answers (or any issues shown above). Submit and generate again to refresh it.': '這份建議是依先前答案產生，未反映目前答案（或上方顯示的問題）。請重新提交並產生結果以更新。',
	'Destination': '目的地',
	'requested style': '要求風格',
	'recommended style': '建議風格',
	'fit': '適配度',
	'Trip days': '旅遊天數',
	'travelers': '旅客數',
	'Budget': '預算',
	'vs. estimated baseline cost': '相較預估基本花費',
	'gap': '差額',
	'budget/person/day': '每人每日預算',
	'— select —': '— 請選擇 —',
	'Illustrative/demo estimate only — synthetic Lab fixtures, not real travel pricing.': '僅供示範的估算——使用合成 Lab fixtures，不代表真實旅遊價格。',
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
