import type { LabLocale } from './locale'

/**
 * Taiwan Chinese for the Explain tab (Lab UX phase 2, M13). Widget vocabulary (widget, Property, State, config, Core,
 * document) stays English, as in the rest of the Lab; a lower-case "preview" in prose is 預覽, like the Selected widget pane.
 * Ids, types, member names and the generated documentation are source data and are never translated.
 */
const zhTWExplainMessages: Readonly<Record<string, string>> = {
	'Explain': '說明',
	'Nothing selected yet': '還沒有選取 widget',
	'Click a widget in the Preview (Inspect) or in the Structure tree to see what it is and why it behaves this way.': '在 Preview 用「檢視」點選 widget，或在「結構」樹中點選，就能看到它是什麼，以及它為什麼會這樣運作。',
	'Why it behaves this way': '為什麼會這樣運作',
	'No current values: there is no valid preview to read them from.': '沒有目前的值：目前沒有可讀取的有效預覽。',
	'No current values: the preview shows the last valid version (r{preview}), not the current document (r{document}).': '沒有目前的值：預覽顯示的是最後一個有效版本（r{preview}），不是目前的 document（r{document}）。',
	'Current values come from the running preview, which shows the current document (r{revision}).': '「目前」的值來自執行中的預覽，它顯示的就是目前的 document（r{revision}）。',
	'None of this widget\'s Properties read another widget: what it shows depends only on its own config and State.': '這個 widget 的 Properties 沒有讀取其他 widget：它呈現的內容只取決於自己的 config 與 State。',
	'Current values': '目前的值',
	'Used by / Depends on': '被誰使用／依賴於',
	'Open dependency graph': '開啟相依性關係圖',
	'Declaration details': '宣告細節',
	'config, slots, members and problems': 'config、slots、members 與問題',
	'{property} reads {widget}\'s {members}': '{property} 讀取 {widget} 的 {members}',
	'{property} calls {widget}\'s {members}': '{property} 呼叫 {widget} 的 {members}',
	'{member} (now: {value})': '{member}（目前：{value}）',
	'Select widget {id}': '選取 widget {id}',
	'(a config field that names this widget)': '（指名這個 widget 的 config 欄位）',
	'no value': '沒有值',
	'not evaluated yet': '尚未求值',
	'failed': '失敗',
	'{source} reads {target}': '{source} 讀取 {target}',
	'{source} writes {target}': '{source} 寫入 {target}',
	'{source} calls {target}': '{source} 呼叫 {target}',
	'reference not resolved': '參照未解析',
	'No other widget uses this one.': '沒有其他 widget 使用它。',
	'This widget does not depend on another widget.': '這個 widget 不依賴其他 widget。',
	'This widget did not resolve, so Core declared nothing for it: no Properties, no dependencies. Its problems are under Declaration details.': '這個 widget 沒有解析成功，所以 Core 沒有為它宣告任何東西：沒有 Properties，也沒有 dependencies。它的問題列在「宣告細節」裡。',
}

/** The zh-TW text of an Explain tab message, or `undefined` when it is not one. */
export function translateExplainMessage(locale: LabLocale, source: string): string | undefined {
	return locale === 'zh-TW' ? zhTWExplainMessages[source] : undefined
}
