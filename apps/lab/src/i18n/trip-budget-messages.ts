import type { LabLocale } from './locale'

/**
 * Lab-owned presentation copy of the Trip budget showcase (issue #230, showcase 1): the Examples menu
 * entries (showcase name, preset names and descriptions) and the guided tour. English source strings are
 * the message ids, exactly as in `messages.ts`; the widgets' own text (titles, the built-in texts of the
 * trip, plugin descriptions) is source-owned and in the trip's own languages
 * (`showcases/trip-budget/domain.ts`), so it never goes through this table.
 *
 * Widget vocabulary (State, Property, Method, Event, Runtime, Relations, Selected widget as a name of a
 * tab) stays English, as everywhere else in the zh-TW Lab.
 */
export const zhTWTripBudgetMessages: Readonly<Record<string, string>> = {
	// Examples menu
	'Trip budget splitter': '旅行分帳',
	'Default — Lisbon weekend': '預設——里斯本週末',
	'Draft with mistakes — four problems': '有錯誤的草稿——四個問題',
	'Run-time failure — a currency with no rate': '執行時失敗——沒有匯率的幣別',
	'A valid trip: four friends, five expenses in euros, dollars and pounds, equal and percentage splits, and the settlement that results.': '一趟有效的旅行：四位朋友、五筆以歐元、美元和英鎊計價的支出、平均與依比例分攤，以及由此算出的結算。',
	'The default with four deliberate mistakes, one per widget: a rate of 0, percentages that add up to 90, a negative amount and a payer who is not on the trip. Each is a located diagnostic.': '預設範例加上四個刻意的錯誤，每個 widget 一個：匯率為 0、比例加起來是 90、負的金額，以及不在旅程中的付款人。每個錯誤都有對應的位置。',
	'The default where the museum tickets are in Swiss francs, which the Currency has no rate for. The Blueprint is valid, but the conversion Method fails when it runs, and every Property that depends on it fails too.': '預設範例中，博物館門票以瑞士法郎計價，而 Currency 沒有這個幣別的匯率。Blueprint 有效，但換算的 Method 在執行時失敗，所有依賴它的 Property 也跟著失敗。',

	// Tutorial confirmation
	'Starting the tutorial will load the Trip budget teaching example and replace your unapplied changes.': '開始教學會載入旅行分帳教學範例，並取代你尚未套用的變更。',

	// Tutorial script
	'This is the Trip budget splitter': '這是旅行分帳',
	'This is the Trip budget splitter — four friends, five expenses and a settlement, rendered from one JSON definition.': '這是旅行分帳——四位朋友、五筆支出和一份結算，由單一 JSON 定義渲染出來。',
	'A chain of Properties across widgets': '跨 widget 的 Property 鏈',
	'Try it: change the Hotel amount from 420 to anything else.': '試試看：把 Hotel 的金額從 420 改成別的數字。',
	'The settlement moved, and nobody told it to. The amount is State on the hotel widget. Everything after it is a Property that reads the one before: amountBase, then shares, then each person\'s owed and balance, then the Settlement\'s balances and transfers. Open Relations to see that chain.': '結算自己動了，沒有人通知它。金額是 hotel widget 上的 State；在它之後的每一個都是讀取前一個的 Property：amountBase、shares、每個人的 owed 與 balance，最後是 Settlement 的 balances 和 transfers。打開 Relations 就能看到這條鏈。',
	'Follow the chain in Relations': '到 Relations 追蹤這條鏈',
	'A read-only Method called by a Property': '被 Property 呼叫的唯讀 Method',
	'Try it: change the Museum tickets currency from USD to GBP.': '試試看：把 Museum tickets 的幣別從 USD 改成 GBP。',
	'The converted amount changed. The museum widget knows no rates: its amountBase Property calls the Currency widget\'s Method convert(amount, currency). Core only lets a Property depend on a Method that is read-only: it writes no State and emits no Event. In Relations, select convert: it has neither a W (writes State) nor an E (emits an Event) badge.': '換算後的金額變了。museum widget 不知道任何匯率：它的 amountBase Property 呼叫 Currency widget 的 Method convert(amount, currency)。Core 只允許 Property 依賴唯讀的 Method：不寫入 State，也不發出 Event。在 Relations 選取 convert：它沒有 W（寫入 State）也沒有 E（發出 Event）標記。',
	'Follow the Method in Relations': '到 Relations 追蹤這個 Method',
	'Another Method, reading State': '另一個 Method，讀取 State',
	'Try it: set "Round transfers to" to a whole unit.': '試試看：把「轉帳金額四捨五入到」改成整數元。',
	'The payments are now whole euros and a note says how far they are from the exact balances. Settlement.transfers calls the Currency\'s second read-only Method, roundTransfer, which reads State roundStep. A Method can read State, so changing the step changes what the Method returns and recomputes every Property that calls it.': '轉帳金額現在是整數歐元，並有一行說明它和精確結餘差多少。Settlement.transfers 呼叫 Currency 的第二個唯讀 Method roundTransfer，而它讀取 State roundStep。Method 可以讀取 State，所以改變 step 就會改變 Method 的回傳值，並讓每個呼叫它的 Property 重新計算。',
	'Computed only when read': '被讀取時才計算',
	'Select the Runtime tab: on the hotel widget, breakdown says Never evaluated.': '切到 Runtime 分頁：在 hotel widget 上，breakdown 顯示 Never evaluated。',
	'On the hotel widget, breakdown says Never evaluated (Runtime or Selected widget). It is a Property, and Properties are lazy: Core runs one only when something reads it, and nothing in the page does yet. The same holds for each person\'s ledger.': '在 hotel widget 上，breakdown 顯示 Never evaluated（在 Runtime 或 Selected widget）。它是 Property，而 Property 是 lazy 的：只有東西讀取它時 Core 才會執行，頁面上目前還沒有任何東西讀它。每個人的 ledger 也是一樣。',
	'Try it: press "Show breakdown" on Hotel.': '試試看：在 Hotel 按下「顯示計算過程」。',
	'Now breakdown has a value. Opening it mounts a component that reads the Property, which subscribes and makes Core run it. Close it and the subscription is released: Core keeps the last result but runs nothing until something reads it again. The Lab shows whether a Property was ever evaluated and its latest result; it cannot show who is subscribed.': '現在 breakdown 有值了。展開它會掛載一個讀取這個 Property 的元件，元件訂閱後 Core 才執行它。收合之後訂閱就被釋放：Core 保留最後的結果，但在有東西再次讀取之前不會執行任何計算。Lab 能顯示 Property 是否曾被計算過以及最新結果，但無法顯示是誰在訂閱。',
	'See breakdown in Selected widget': '在 Selected widget 查看 breakdown',
	'Starting over with resetState': '用 resetState 重新開始',
	'Make sure the Hotel amount is not 420 (type another number).': '確認 Hotel 的金額不是 420（輸入別的數字）。',
	'The Hotel amount is not the 420 the document authored.': 'Hotel 的金額不是起始文件寫的 420。',
	'Try it: press "Reset this expense" on Hotel.': '試試看：在 Hotel 按下「重設這筆支出」。',
	'Hotel went back to 420, the value the document authored, and the settlement followed. "Reset this expense" asks the host for widget.resetState(): every State member of that widget returns to its initial value. "Start over" calls runtime.resetState() for all widgets, and the host then writes the interface language back, so the page does not switch language. It resets State only: Property and Method diagnostics are not cleared.': 'Hotel 回到 420，也就是起始文件寫的值，結算也跟著回來。「重設這筆支出」是請 host 呼叫 widget.resetState()：該 widget 的每個 State 都回到初始值。「重新開始」則對所有 widget 呼叫 runtime.resetState()，之後 host 會把介面語言寫回去，頁面才不會跟著切換語言。它只重設 State：Property 與 Method 的 diagnostics 不會被清除。',
	'Two kinds of failure': '兩種失敗',
	'Open the Examples menu and load "Draft with mistakes", then "Run-time failure".': '打開「範例」選單，先載入「有錯誤的草稿」，再載入「執行時失敗」。',
	'Draft with mistakes has four located diagnostics (a rate of 0, percentages that add up to 90, a negative amount, a payer who is not on the trip): they appear in Problems, and the Preview keeps the last valid version. Run-time failure compiles, but its museum currency has no rate: Currency.convert fails when it runs, and every Property that depends on it fails too. Select the museum widget in Selected widget: amountBase and shares say Failed, with the diagnostic.': '「有錯誤的草稿」有四個帶位置的 diagnostics（匯率為 0、比例加起來是 90、負的金額、不在旅程中的付款人）：它們會出現在「問題」清單，Preview 則保留最後一個有效版本。「執行時失敗」可以編譯，但博物館的幣別沒有匯率：Currency.convert 在執行時失敗，所有依賴它的 Property 也跟著失敗。在 Selected widget 選取 museum widget：amountBase 和 shares 會顯示 Failed 與對應的 diagnostic。',
	'Dependencies (Relations, Graph) = the declared chain between widgets · Selected widget = one widget\'s declaration and Runtime values · Runtime = every widget\'s State and Properties (Never evaluated until something reads them) · Events = Method failures and Events as they happen · Implementation = the plugin and renderer code behind this widget type.': '相依性（Relations、關係圖）= widget 之間已宣告的鏈 · Selected widget = 一個 widget 的宣告與 Runtime 的值 · Runtime = 每個 widget 的 State 與 Properties（沒有東西讀取之前都是 Never evaluated）· Events = 即時的 Method failure 與 Events · Implementation = 這個 widget type 背後的 plugin 與 renderer 程式碼。',
	'You have seen a Property chain, read-only Methods, laziness and resetState.': '你已經看過 Property 鏈、唯讀 Method、lazy 計算和 resetState。',
	'Edit the JSON (add an expense, a person or a rate) and press Apply, or open the Implementation of any widget type.': '可以編輯 JSON（新增一筆支出、一個成員或一個匯率）後按「套用」，或打開任一 widget type 的 Implementation。',
}

export function translateTripBudgetMessage(locale: LabLocale, source: string): string | undefined {
	return locale === 'zh-TW' ? zhTWTripBudgetMessages[source] : undefined
}
