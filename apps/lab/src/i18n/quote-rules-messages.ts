import type { LabLocale } from './locale'

/**
 * Lab-owned presentation copy of the Quote rules showcase (issue #230, showcase 2): the Examples menu entries
 * (showcase name, preset names and descriptions) and the guided tour. English source strings are the message ids,
 * exactly as in `messages.ts`; the widgets' own text (titles, paper names and rule labels) is source-owned and in the
 * quote's own languages, and the Preview's own chrome is the showcase's (`showcases/quote-rules/messages.ts`), so
 * neither goes through this table.
 *
 * Widget vocabulary (State, Property, Method, Event, Runtime, Relations, Selected widget as a name of a tab) stays
 * English, as everywhere else in the zh-TW Lab. The messages of Valibot and of Core are never translated.
 */
export const zhTWQuoteRulesMessages: Readonly<Record<string, string>> = {
	// Examples menu
	'Quote rules shared by browser and backend': '報價規則：瀏覽器與後端共用',
	'Default — Corner Press print job': '預設——轉角印刷的印製報價',
	'Invalid config — schema library diagnostics': '無效的設定——schema 函式庫的診斷',
	'Buggy rule — an isolated exception': '有問題的規則——被隔離的例外',
	'A valid quote: three printed items, a volume discount, a rush surcharge, a delivery fee and a sales tax, all priced by rule widgets, and the same document priced again in a Web Worker.': '一份有效的報價：三個印刷品項、數量折扣、急件加價、運費和營業稅，全部由規則 widget 計價，同一份文件還會在 Web Worker 裡再計算一次。',
	'The default with mistakes in the configs of five widgets. Valibot, through Standard Schema, finds each one and its own message becomes the Core diagnostic, verbatim and at the place it was found.': '預設範例，但五個 widget 的 config 有錯。Valibot 透過 Standard Schema 找出每一個錯誤，它自己的訊息會原文成為 Core 的 diagnostic，並標在發現的位置。',
	'A valid document whose volume tiers start at 100. The rule\'s code assumes the first tier starts at 1, so lowering the total quantity below 100 makes it throw: Core isolates the exception and the Preview reports it instead of crashing.': '一份有效的文件，但數量折扣的級距從 100 起算。規則的程式碼假設第一級從 1 開始，所以把總數量降到 100 以下就會拋出例外：Core 會隔離這個例外，Preview 會回報而不是當掉。',

	// Tutorial confirmation
	'Starting the tutorial will load the Quote rules teaching example and discard the JSON that can\'t be applied yet.': '開始教學會載入報價規則教學範例，並捨棄目前還無法套用的 JSON。',

	// Tutorial script
	'This is the Quote rules showcase': '這是報價規則範例',
	'This is a print shop quote: one JSON definition, priced by rule widgets in the page, and priced again by a Web Worker from the very same files.': '這是一份印刷店的報價：一份 JSON 定義，由頁面中的規則 widget 計價，再由 Web Worker 用完全相同的檔案計算一次。',
	'The same rules, outside the page': '同一組規則，在頁面之外執行',
	'Try it: change the A5 flyers quantity from 500 to another number.': '試試看：把 A5 傳單的數量從 500 改成別的數字。',
	'Both columns moved, and both show the same JSON. The right-hand one was computed by a Web Worker, which has no document and no window: it was given only the document and the Quote widget\'s Property answers, as JSON text, wrote the answers into a fresh Runtime and read the Property quote. There is no second implementation of a price rule to keep in step, because the browser and the backend run the same plugin files.': '兩欄都動了，而且 JSON 完全相同。右邊那一欄是 Web Worker 算出來的，它沒有 document 也沒有 window：它只拿到文件和 Quote widget 的 Property answers（都是 JSON 文字），把答案寫進一個全新的 Runtime，再讀取 Property quote。不需要維護第二套計價規則的實作，因為瀏覽器和後端執行的是同一批 plugin 檔案。',
	'See answers and quote in Selected widget': '在 Selected widget 查看 answers 與 quote',
	'Rules are widgets': '規則就是 widget',
	'Try it: switch on Rush production and choose Courier as the delivery method.': '試試看：開啟「急件加價」，並把運送方式選成「快遞配送」。',
	'Each rule is its own plugin with its own State: Rush production owns enabled, Delivery owns method. The tax is applied last: Quote.taxableCents reads the discount, the rush surcharge and the delivery fee, and SalesTax.adjustment reads taxableCents. Core checks that chain for loops, and Relations shows it.': '每條規則都是自己的 plugin，擁有自己的 State：急件加價擁有 enabled，運送擁有 method。稅金最後才算：Quote.taxableCents 讀取折扣、急件加價和運費，SalesTax.adjustment 再讀取 taxableCents。Core 會檢查這條鏈有沒有迴圈，Relations 會把它畫出來。',
	'Follow the chain in Relations': '到 Relations 追蹤這條鏈',
	'One schema, three jobs': '一份 schema，三種用途',
	'Open Edit, then Structure, and look at the volume widget\'s config.': '打開「編輯」，再切到「結構」，看看 volume widget 的 config。',
	'The config of every rule is a Valibot schema used through Standard Schema. It is the validator (one small guard turns each issue into a diagnostic), the TypeScript type, and, through Standard JSON Schema, the config JSON Schema that Core publishes in the Catalog. That is why Structure offers a list of tiers with Add and Remove and number boxes: the controls are built from the schema. Core never runs the JSON Schema, and a refinement it cannot express would be missing from it.': '每條規則的 config 都是透過 Standard Schema 使用的 Valibot schema。它同時是驗證器（一個小小的 guard 把每個問題轉成 diagnostic）、TypeScript 型別，以及經由 Standard JSON Schema 取得、由 Core 放在 Catalog 的 config JSON Schema。所以 Structure 才會提供有新增與移除按鈕的級距清單和數字欄位：這些控制項都是從 schema 產生的。Core 不會執行 JSON Schema，而它無法表達的 refinement 也不會出現在裡面。',
	'Open Edit': '打開「編輯」',
	'The library\'s own messages': '函式庫自己的訊息',
	'Open the Examples menu and load "Invalid config".': '打開「範例」選單，載入「無效的設定」。',
	'The default with mistakes in five widgets. Every message in Problems is Valibot\'s own, word for word, at the place it was found: a string where a number is expected, a quantity of 2.5, an unrecognized key, a percentage over 100. Core only receives what the guard reports, and the Preview keeps the last valid version.': '預設範例，但五個 widget 有錯。「問題」清單裡的每則訊息都是 Valibot 自己的原文，並標在發現的位置：該是數字卻給了字串、數量 2.5、無法辨識的 key、超過 100 的百分比。Core 只會收到 guard 回報的內容，Preview 則保留最後一個有效版本。',
	'A rule that throws': '會拋出例外的規則',
	'Open the Examples menu, load "Buggy rule", then set the A5 flyers quantity to 50: with the poster that is 52 pieces, below the first volume tier (100).': '打開「範例」選單，載入「有問題的規則」，再把 A5 傳單的數量設成 50：加上海報共 52 件，低於第一級數量折扣（100）。',
	'The write succeeded. But the volume rule\'s compute threw a TypeError, because the total number of pieces is below every tier and the code assumed the smallest tier starts at 1. A throwing compute is not a Diagnostic. Core isolated it so the write and every other subscriber were unaffected, and handed it to setIsolatedErrorHandler, which this page installed: see Isolated exceptions. The amounts are the last ones that worked, and the page says so. The Lab\'s Runtime and Selected widget still show volume.adjustment\'s last completed value, because Core\'s inspection reports only completed results: it cannot show that exception.': '寫入成功了。但 volume 規則的 compute 拋出了 TypeError，因為總件數低於所有級距，而程式碼假設最小的級距從 1 開始。compute 拋出例外不是 Diagnostic。Core 把它隔離起來，讓寫入和其他訂閱者都不受影響，並交給這個頁面安裝的 setIsolatedErrorHandler：請看「被隔離的例外」。頁面上的金額是最後一次成功的結果，頁面也這麼說明。Lab 的 Runtime 和 Selected widget 仍顯示 volume.adjustment 最後一次完成的值，因為 Core 的 inspection 只回報已完成的結果：它看不到這個例外。',
	'See volume in Selected widget': '在 Selected widget 查看 volume',
	'Tools, beside the Preview: Dependencies (Relations, Graph) = the declared chain between widgets · Selected widget = one widget\'s declaration and Runtime values · Runtime tree = every widget\'s State and Properties · Events log = Method failures and Events as they happen · Implementation = the plugin, schema and renderer code behind this widget type.': '工具（在 Preview 旁開啟）：相依性（Relations、關係圖）= widget 之間已宣告的鏈 · Selected widget = 一個 widget 的宣告與 Runtime 的值 · Runtime 樹 = 每個 widget 的 State 與 Properties · Events 紀錄 = 即時的 Method failure 與 Events · Implementation = 這個 widget type 背後的 plugin、schema 與 renderer 程式碼。',
	'You have seen the same rules in a page and a Web Worker, a schema library through Standard Schema and an isolated exception.': '你已經看過同一組規則在頁面和 Web Worker 裡執行、透過 Standard Schema 使用的 schema 函式庫，以及被隔離的例外。',
	'Edit the JSON (change a tier, add a paper, set a tax rate) and watch the Preview update, or open the Implementation of any widget type.': '可以編輯 JSON（改一個級距、新增一種紙張、設定稅率），看 Preview 跟著更新，或打開任一 widget type 的 Implementation。',
}

export function translateQuoteRulesMessage(locale: LabLocale, source: string): string | undefined {
	return locale === 'zh-TW' ? zhTWQuoteRulesMessages[source] : undefined
}
