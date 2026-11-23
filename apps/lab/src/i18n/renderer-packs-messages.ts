import type { LabLocale } from './locale'

/**
 * Lab-owned presentation copy of the "One document, two renderer packs" showcase (issue #230): the Examples menu entries
 * (showcase name, preset names and descriptions) and the guided tour. English source strings are the message ids, exactly as in
 * `messages.ts`; the document's own texts are source-owned (`{ en, zh-TW }` objects) and the Preview's own chrome is the showcase's
 * (`showcases/renderer-packs/messages.ts`), so neither goes through this table.
 *
 * Widget vocabulary (State, Property, Method, Event, Runtime, Blueprint, Selected widget as a name of a tab) stays English, as
 * everywhere else in the zh-TW Lab, and so do the names of the packs' own technology (Nuxt UI, Tailwind, Vue). API names
 * (dep.widget, createWidgetVueRenderer, notify, confirm, ask), widget ids and config keys are never translated.
 */
export const zhTWRendererPacksMessages: Readonly<Record<string, string>> = {
	// Examples menu
	'One document, two renderer packs': '一份文件，兩組 renderer pack',
	'Default — workspace settings in two renderer packs': '預設——兩組 renderer pack 的工作區設定',
	'A valid workspace settings page: an Appearance and a Notifier as capability widgets, and fields that name them by id. The preview draws it with hand-written controls or with Nuxt UI, one at a time or side by side, from the same Runtime.': '一個有效的工作區設定頁：Appearance 與 Notifier 是 capability widget，欄位則以 id 指名它們。Preview 可以用手寫控制項或 Nuxt UI 繪製它，一次一組或並排顯示，而且都來自同一個 Runtime。',
	'The settings document is invalid: a text field with a limit of 0, a field that reads an Appearance that does not exist, a field that names a Notifier as its Appearance, and a dangerous action that reports to a Notifier that does not exist. Each is a located diagnostic.': '這份設定文件是無效的：上限為 0 的文字欄位、讀取不存在之 Appearance 的欄位、把 Notifier 當成 Appearance 的欄位，以及回報給不存在之 Notifier 的危險動作。每一個都是有位置的診斷。',

	// Tutorial confirmation
	'Starting the tutorial will load the Renderer packs teaching example and discard the JSON that can\'t be applied yet.': '開始教學會載入 renderer pack 教學範例，並捨棄目前還無法套用的 JSON。',

	// Tutorial script
	'This is the renderer packs showcase': '這是 renderer pack 範例',
	'This is a workspace settings page, drawn from one Document by hand-written controls.': '這是一個工作區設定頁，由一份 Document 以手寫控制項繪製。',
	'This is a workspace settings page, drawn from one Document and one Runtime. The widgets are ordinary: a SettingsPage with an Appearance and a Notifier as capability widgets, and Sections of text fields, switches, a choice and two dangerous actions. How they are drawn is a second question, answered by a renderer pack: this one is hand-written Vue components with scoped CSS, and a second pack uses Nuxt UI. Both register a renderer for every plugin type of the same System.': '這是一個工作區設定頁，由一份 Document 與一個 Runtime 繪製。widget 都很普通：SettingsPage 底下有作為 capability widget 的 Appearance 與 Notifier，以及由文字欄位、開關、選項與兩個危險動作組成的 Section。怎麼繪製是另一個問題，由 renderer pack 回答：這一組是手寫的 Vue 元件加 scoped CSS，另一組使用 Nuxt UI。兩組都為同一個 System 的每個 plugin 類型註冊 renderer。',
	'State is written by whichever control you use': '不管用哪個控制項，寫入的都是 State',
	'Change the text of the "Workspace name" box.': '修改「Workspace name」欄位的文字。',
	'The box wrote State value of the TextField. Writing State is always accepted, even for a name that is too long: the Property message says so, in both languages, and every pack shows the same message for the same value. Selected widget and Runtime show the State and the Properties.': '這個欄位寫入了 TextField 的 State value。寫入 State 一律會被接受，即使名稱太長也一樣：Property message 會用兩種語言說明，而且每一組 pack 對同一個值顯示相同的訊息。Selected widget 與 Runtime 會顯示 State 與 Properties。',
	'See the State in Selected widget': '在 Selected widget 查看 State',
	'Switch the renderer pack': '切換 renderer pack',
	'Choose "Nuxt UI" in the renderer pack chooser, then look at the Workspace name box.': '在 renderer pack 選擇器選「Nuxt UI 元件庫」，再看 Workspace name 欄位。',
	'The same text is in the Nuxt UI input. The chooser is a choice of the host, not widget State: the Runtime tree shows no pack, no Method can change it, and the Runtime was neither disposed nor created again. Switching unmounts one pack\'s renderers and mounts the other\'s over the same State. The Nuxt UI pack runs in a nested Vue app of its own, with its own Nuxt UI instance, so the page does not depend on the frame having one.': 'Nuxt UI 的輸入框裡是同樣的文字。選擇器是 host 的選擇，不是 widget 的 State：Runtime 樹不會顯示 pack，沒有任何 Method 能改變它，Runtime 既沒有被釋放，也沒有重新建立。切換只是卸載一組 pack 的 renderer，並在同一份 State 上掛載另一組。Nuxt UI pack 跑在自己的巢狀 Vue app 裡，有自己的 Nuxt UI 實例，所以頁面不必依賴 frame 提供一個。',
	'Open the Runtime tree': '開啟 Runtime 樹',
	'A provider is named, not found by ancestry': 'provider 是被指名的，不是靠祖先找到的',
	'Choose "Compact" density in the Appearance panel.': '在 Appearance 面板選擇「緊湊」密度。',
	'Every field became denser, in whichever pack is on screen. The fields did not look the Appearance up: each one names it in its own config (appearance) and declares a dependency with dep.widget(id), so its Property density follows the Appearance\'s State. Core has no nearest-ancestor or provider lookup, so there is no provider shadowing either: a field reads exactly the widget it names. Dependencies, in Tools, lists those reads.': '不論畫面上是哪一組 pack，每個欄位都變得更緊湊。欄位並沒有去「找」Appearance：每個欄位都在自己的 config（appearance）指名它，並以 dep.widget(id) 宣告依賴，所以它的 Property density 會跟著 Appearance 的 State 走。Core 沒有最近祖先或 provider 的查找，所以也沒有 provider 遮蔽：欄位讀的就是它指名的那個 widget。「工具」裡的 Dependencies 會列出這些讀取。',
	'Open Dependencies': '開啟 Dependencies',
	'The mode is State, the theme is the host\'s': '模式是 State，主題是 host 的',
	'Choose "Dark" as the colour mode.': '把色彩模式選為「深色」。',
	'The page turned dark, whatever the Lab\'s own theme is. State mode is auto, light or dark; "auto" means the host theme, which Core does not know, so the pack resolves it. The hand-written pack changes its own custom properties; the Nuxt UI pack puts a dark class on its own root element and never on the frame document.': '不管 Lab 本身是什麼主題，頁面都變成深色。State mode 是 auto、light 或 dark；「auto」指的是 host 主題，Core 並不知道它，所以由 pack 自己解析。手寫的 pack 改的是自己的 custom properties；Nuxt UI pack 則把 dark class 加在自己的根元素上，絕不加在 frame 文件上。',
	'A confirmation is State too': '確認也是 State',
	'Press "Archive workspace".': '按「封存工作區」。',
	'The button called the Method ask, which wrote State confirming, and the pack drew a modal from that fact: a native dialog in the hand-written pack, a UModal in the Nuxt UI pack. The modal is inside the Preview frame, so the Lab around it stays usable: try the Examples menu, then come back. Keep this dialog open for the next step.': '按鈕呼叫了 Method ask，它寫入了 State confirming，而 pack 依這個事實畫出 modal：手寫 pack 用原生 dialog，Nuxt UI pack 用 UModal。modal 在 Preview frame 裡面，所以它外面的 Lab 仍然可以操作：試試範例選單，再回來。下一步要用，請保持這個對話框開著。',
	'A Method that calls another widget\'s Method': '呼叫另一個 widget 之 Method 的 Method',
	'Press "Confirm" in the dialog, and keep the Events log open.': '在對話框按「確認」，並保持 Events 紀錄開著。',
	'confirm did three things: it invoked the Notifier\'s Method notify through a dependency on the widget its config names (notifier), it closed the question, and it emitted confirmed. The Notifier wrote State and emitted notified. The Events log lists both Events with their payloads, and Relations marks confirm as W and E. The page announces the new warning as its one alert; a notification of any other tone would be its one status.': 'confirm 做了三件事：透過對「config 指名的 widget（notifier）」的依賴呼叫 Notifier 的 Method notify、關閉確認、並發出 confirmed。Notifier 寫入了 State 並發出 notified。Events 紀錄會列出這兩個 Event 與它們的 payload，Relations 則把 confirm 標為 W 與 E。頁面把這則新的警告當成唯一的 alert 播報；其他語氣的通知則會是唯一的 status。',
	'Open the Events log': '開啟 Events 紀錄',
	'Both packs at once': '兩組 pack 一起顯示',
	'Choose "Side by side" and change a field in one pane.': '選「並排」，並在其中一個窗格修改欄位。',
	'Both packs draw the same Runtime next to each other, and the other pane follows at once: State is the only source. The page still has one alert, one status and one open confirmation: the first pane carries the live regions, and a confirmation belongs to the pane whose button asked. Both packs stamp inspect anchors on their renderer roots, so Inspect can select a widget in either.': '兩組 pack 並排繪製同一個 Runtime，另一個窗格會立刻跟著變：State 是唯一的來源。頁面仍然只有一個 alert、一個 status 與一個開啟中的確認：第一個窗格負責 live region，確認則屬於按下按鈕的那個窗格。兩組 pack 都在 renderer 根元素上加了 inspect anchor，所以 Inspect 在任一邊都能選到 widget。',
	'Map the views': '認識各個檢視',
	'Each of these views is a real navigation shortcut — try one.': '這些檢視都是真正可用的導覽捷徑——試試其中一個。',
	'Tools, beside the Preview: Blueprint tree = the settings document and its diagnostics · Selected widget = a widget\'s State, Properties and Methods · Runtime tree = every widget\'s State and Properties, and no renderer pack: that is the host\'s · Dependencies = the reads and Method calls between widgets, which are the named providers · Implementation = the plugin and both renderers of a widget type, side by side.': '工具（在 Preview 旁開啟）：Blueprint 樹 = 設定文件與它的診斷 · Selected widget = 某個 widget 的 State、Properties 與 Methods · Runtime 樹 = 每個 widget 的 State 與 Properties，不含 renderer pack，因為那是 host 的 · Dependencies = widget 之間的讀取與 Method 呼叫，也就是被指名的 provider · Implementation = 某個 widget 類型的 plugin 與兩個 renderer，並排呈現。',
	'Try it yourself': '換你試試',
	'You have seen one Runtime drawn by two renderer packs, providers that are named instead of found, a Method that calls another widget\'s Method and a confirmation that stays inside the Preview.': '你已經看過同一個 Runtime 由兩組 renderer pack 繪製、被指名而不是被找到的 provider、呼叫另一個 widget 之 Method 的 Method，以及停留在 Preview 之內的確認。',
	'Edit the JSON (change a field\'s appearance or the Notifier\'s limit) and watch the Preview update, load "Draft with mistakes" to see the structure diagnostics for a name that matches no widget, or open the Implementation of TextField to read its plugin next to both of its renderers.': '編輯 JSON（改某個欄位的 appearance 或 Notifier 的 limit），看 Preview 跟著更新，載入「有錯誤的草稿」看名稱對不到任何 widget 的結構診斷，或打開 TextField 的 Implementation，把它的 plugin 與兩個 renderer 放在一起閱讀。',
}

export function translateRendererPacksMessage(locale: LabLocale, source: string): string | undefined {
	return locale === 'zh-TW' ? zhTWRendererPacksMessages[source] : undefined
}
