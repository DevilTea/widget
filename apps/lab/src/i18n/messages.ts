import type { LabLocale } from './locale'

/**
 * Lab-owned presentation copy only. English source strings are stable message ids so framework-agnostic
 * tutorial scripts and panel metadata stay free of i18n dependencies; semantic/source-owned strings
 * are never passed through this table merely because they are visible in the Lab.
 */
const zhTWMessages: Readonly<Record<string, string>> = {
	'Widget Lab': 'Widget Lab',
	'Sandbox': '沙盒',
	'Interactive Survey': '互動式問卷',
	'Tutorial': '教學',
	'Resume tutorial': '繼續教學',
	'Restart tutorial': '重新開始教學',
	'Pause tutorial': '暫停教學',
	'Blueprint': 'Blueprint',
	'Runtime': 'Runtime',
	// Panel and view names are Lab navigation, so they are Taiwan Chinese; Widget vocabulary (Blueprint, Runtime,
	// Preview, Document, State, Property, Method, Event) stays English, as it is in the docs and in Core's own text. A tab
	// whose name is navigation around such a word mixes the two, as 選取的 widget does: Events 紀錄, Document 工具; 實作 is
	// the word the Lab already uses for Implementation elsewhere ("查看實作").
	'Author': '編寫',
	'Dependencies': '相依性',
	'Relations': '關聯',
	'Catalog': '目錄',
	'Structure': '結構',
	'JSON': 'JSON',
	'Document Tools': 'Document 工具',
	'active': '運作中',
	'unavailable': '無法使用',
	'valid': '有效',
	'invalid': '無效',
	'diagnostic': '問題',
	'diagnostics': '問題',
	// Revert discards the unapplied draft and Undo goes back one committed change: two different actions, so the zh-TW
	// labels are not near-synonyms (還原 / 復原 were).
	'Revert': '捨棄草稿',
	'Format': '格式化',
	'Apply': '套用',
	'Applying…': '套用中…',
	'Language': '語言',
	// The overflow menu's language entry sets the Lab's own language, not a showcase's (the survey has its own select).
	'Lab language': 'Lab 介面語言',
	'English': 'English',
	'Traditional Chinese (Taiwan)': '繁體中文（台灣）',
	'Dismiss': '關閉說明',
	'Widget Lab is designed for a desktop-sized viewport. Widen the window to continue.': 'Widget Lab 是為桌面尺寸的視窗設計。請加寬視窗後繼續。',

	'Widget Lab lets you change a real app, then see where that behavior comes from.': 'Widget Lab 讓你直接操作一個真實應用程式，再追查這些行為從哪裡來。',
	'Start with one small interaction; we\'ll show what changed and why.': '先從一個小互動開始；我們會帶你看發生了什麼變化，以及原因。',
	'Start the tour': '開始教學',
	'Explore on my own': '自行探索',
	'Starting the tutorial will load the Survey teaching example and replace your unapplied changes.': '開始教學會載入問卷教學範例，並取代你尚未套用的變更。',
	'Start tour': '開始教學',
	'Cancel': '取消',

	'Step {current} of {total}': '第 {current} 步，共 {total} 步',
	'Close tutorial': '關閉教學',
	'Back': '上一步',
	'Skip tour': '略過教學',
	'Next': '下一步',
	'Finish': '完成',

	'This is the Interactive Survey': '這是互動式問卷',
	'This is the Interactive Survey — a sign-up form rendered from one JSON definition.': '這是互動式問卷——一份由單一 JSON 定義渲染出來的報名表單。',
	'One answer, stored as State': '一個答案，儲存在 State',
	'Try it: choose "On site" for "How will you join?".': '試試看：在「How will you join?」選擇「On site」。',
	'Guests and Phone reacted. Your choice is stored as State on the mode widget — the radio buttons present that State and forward your click to it, but the Runtime owns the value.': 'Guests 與 Phone 跟著變了。你的選擇以 State 儲存在 mode widget 上——選項按鈕只是呈現這個 State，並把你的點擊轉交給它，真正擁有這個值的是 Runtime。',
	'See it in Runtime': '到 Runtime 查看',
	'A derived value': '衍生出的值',
	'The required message under "How will you join?" went away by itself — no action needed here.': '「How will you join?」下方的必填提示自己消失了——這一步不需要操作。',
	'The required message under "How will you join?" disappeared, and Phone now says it is required. errors and required are Properties: values derived from State by rules in the definition. The Runtime owns the rule — no Vue code computed them.': '「How will you join?」下方的必填提示消失了，而 Phone 現在標示為必填。errors 與 required 都是 Properties：由定義裡的規則從 State 推導出來的值。規則屬於 Runtime——沒有任何 Vue 程式碼計算它們。',
	'An answer error — and recovery': '答案錯誤——以及恢復',
	'Try it: set Guests to 5.': '試試看：把 Guests 設成 5。',
	'Guests reports an error, yet your number is still stored: answer errors are data — the form, the submit button and a backend all read the same errors Property.': 'Guests 顯示錯誤，但你輸入的數字仍然被儲存：答案錯誤是資料——表單、送出按鈕和後端讀的都是同一個 errors Property。',
	'Now set Guests to 2.': '現在把 Guests 改成 2。',
	'The error is gone. Errors are current Runtime results — never a permanently broken page.': '錯誤消失了。錯誤只是 Runtime 目前的結果——頁面永遠不會因此壞掉。',
	'A declared dependency': '宣告式 dependency',
	'Try it: switch "How will you join?" to "Online".': '試試看：把「How will you join?」改成「Online」。',
	'Guests disappeared. Its visibility rule is a declared dependency on the value of the mode question — and a hidden question has no value.': 'Guests 消失了。它的顯示規則是一個已宣告的 dependency，讀取 mode 這題的 value——而被隱藏的題目沒有 value。',
	'Now switch back to "On site".': '現在改回「On site」。',
	'Guests is back, still holding your answer: hiding never erased the stored answer. The same declared dependency, read live, both ways.': 'Guests 回來了，仍然保有你的答案：隱藏不會清除已儲存的答案。同一個已宣告的 dependency 會即時讀取，兩個方向都成立。',
	'A direct write vs. a Method': '直接寫入與 Method',
	'Tick a session, type a phone number, then press Submit.': '勾選一個場次、填入電話號碼，然後按 Submit。',
	'Your answers were direct State writes. Submit invokes a named Method: it checks that the survey has no errors, refuses otherwise, and on success stores the response and emits a submitted Event for the host.': '你的答案都是直接寫入 State。Submit 則是呼叫一個具名的 Method：它會檢查問卷沒有錯誤，有錯就拒絕；成功時儲存 response，並發出 submitted Event 給 host。',
	'Snapshot vs. live': 'Snapshot 與 live 值',
	'Now change any answer (for example, Guests) and watch the Submitted panel.': '現在修改任一答案（例如 Guests），並觀察 Submitted 區塊。',
	'The submitted copy kept its values and gained the "Answers changed since you submitted" marker. The submission is a stored State snapshot; the response is a live Property — open "Response — what a backend reads" below the form to see its current values.': '已送出的副本保留原本的值，並出現「Answers changed since you submitted」標記。送出的內容是儲存起來的 State snapshot；response 則是即時的 Property——展開表單下方的「回應——後端讀取的內容」即可看到它目前的值。',
	'Map the views': '理解各個檢視',
	'Each of these views is a real navigation shortcut — try one.': '這些檢視都是實際可用的導覽捷徑——選一個試試看。',
	'Author = the declarative definition and structure you edit · Blueprint = what the applied Author source compiled into · Runtime = live State/Properties/Methods/Diagnostics · Dependencies = declared dependencies · Preview = the Vue presentation · Implementation = the plugin + renderer code behind this widget type.': '編寫 = 你編輯的 declarative definition 與結構 · Blueprint = 已套用的編寫內容 source 編譯後的結果 · Runtime = live State / Properties / Methods / Diagnostics · 相依性 = 已宣告 dependencies · Preview = Vue 呈現層 · Implementation = 這個 widget type 背後的 plugin + renderer 程式碼。',
	'Starting the tutorial opens its teaching example in another showcase. Your edits to this document will be discarded, and Undo cannot bring them back.': '開始教學會在另一個展示範例中開啟教學內容。你對這份文件的修改會被捨棄，而且無法用「復原上一步」找回。',
	'Source': 'Source',
	'Graph': '關係圖',
	'Preview': 'Preview',
	'Implementation': '實作',
	// The Events log tab ("Events" in English); the Catalog's "Events" label keeps the bare Widget word.
	'Events log': 'Events 紀錄',
	'Try it yourself': '接下來自己試試看',
	'You now know State, Property, Method, and dependency.': '你現在已經認識 State、Property、Method 與 dependency。',
	'Open any inspector, or edit the Author JSON and press Apply.': '可以打開任一 inspector，或直接編輯 JSON 後按「套用」。',
}

export function translateMessage(locale: LabLocale, source: string): string {
	if (locale === 'en')
		return source
	return zhTWMessages[source] ?? source
}
