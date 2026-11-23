import type { LabLocale } from './locale'

/**
 * Taiwan Chinese for the workbench of Lab UX phase 3B: the Edit / Explain / Tools tabs, the Tools menu and the names of the
 * expert views it opens, the Edit tab's toolbar and the "Browse widget types" slide-over. Navigation is Taiwan Chinese and
 * Widget vocabulary stays English (Blueprint, Runtime, Events, Preview, Document, SourcePatch), as in the rest of the Lab:
 * a view named after a Widget word mixes the two, as Events 紀錄 and Document 工具 already do.
 */
const zhTWWorkbenchMessages: Readonly<Record<string, string>> = {
	'Edit': '編輯',
	'Tools': '工具',
	'Edit views': '編輯檢視',
	'Edit the current document in Structure or as JSON. Each change applies at once, and Undo takes it back.': '在「結構」或 JSON 中編輯目前的 document。每個變更都會立刻套用，「復原上一步」可以撤回。',
	'Browse widget types': '瀏覽 widget 類型',
	'Widget types': 'Widget 類型',
	'Close widget types': '關閉 widget 類型',
	'Expert views': '進階檢視',
	'Expert views. Each one opens in its own tab beside the Preview, so what you are reading stays here.': '進階檢視。每一個都會在 Preview 旁的獨立分頁開啟，你正在看的內容會留在這裡。',
	'Open': '已開啟',
	'Blueprint tree': 'Blueprint 樹',
	'Runtime tree': 'Runtime 樹',
	'Dependency graph and Relations': '相依性：關係圖與關聯',
	'What the definition compiled into: every widget, its status and its diagnostics.': '定義編譯後的結果：每個 widget、它的狀態與問題。',
	'The running preview: live State, Properties and Methods of every widget.': '正在執行的預覽：每個 widget 即時的 State、Properties 與 Methods。',
	'What the widgets announced while you used the preview, and Method failures.': '你操作預覽時 widget 發出的 Events，以及 Method failure。',
	'Which widget reads which, as a list (Relations) or a graph.': '哪個 widget 讀取哪個，以清單（關聯）或關係圖呈現。',
	'The selected widget\'s declaration and its live values side by side.': '選取的 widget 的宣告與即時值，並排呈現。',
	'The last change as a SourcePatch, a conflict check and the separated source, for developers.': '給開發者：上一次變更的 SourcePatch、衝突檢查與分離後的 source。',
	'The plugin and renderer code behind the selected widget\'s type.': '選取的 widget 所屬 type 背後的 plugin 與 renderer 程式碼。',
	'Implementation — {subject}': '實作 — {subject}',
	'View implementation of {widget}': '查看 {widget} 的實作',
}

/** The zh-TW text of a workbench message, or `undefined` when it is not one. */
export function translateWorkbenchMessage(locale: LabLocale, source: string): string | undefined {
	return locale === 'zh-TW' ? zhTWWorkbenchMessages[source] : undefined
}
