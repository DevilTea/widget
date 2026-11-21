import type { LabLocale } from './locale'

/**
 * Lab-owned presentation copy of the Onboarding showcase (issue #230, showcase 3): the Examples menu entries
 * (showcase name, preset names and descriptions) and the guided tour. English source strings are the message ids,
 * exactly as in `messages.ts`; the widgets' own text (titles, interests and safety rules) is source-owned and in the
 * wizard's own languages, and the Preview's own chrome is the showcase's (`showcases/onboarding/messages.ts`), so
 * neither goes through this table.
 *
 * Widget vocabulary (State, Property, Method, Event, Runtime, Relations, Selected widget as a name of a tab) stays
 * English, as everywhere else in the zh-TW Lab. Method and Event names, diagnostic codes and reasons are never translated.
 */
export const zhTWOnboardingMessages: Readonly<Record<string, string>> = {
	// Examples menu
	'Onboarding wizard with an Events log': '新成員引導精靈：Events 與 Method 診斷',
	'Default — Tidepool Makers onboarding': '預設——潮池工坊新成員引導',
	'Ready to book — only the induction left': '準備預約——只剩新手導覽',
	'Deep link — opens on step 4, nothing filled in': '深層連結——直接開在第 4 步，什麼都還沒填',
	'Draft with mistakes — four problems': '有錯誤的草稿——四個問題',
	'A valid wizard: your details, interests, a three-rule safety briefing and an induction slot to book. Booking is asked of a simulated office that the page, not the widget, waits for.': '一份有效的精靈：你的資料、興趣、三條規則的安全說明，以及要預約的新手導覽時段。預約是向模擬的櫃台詢問，等待的是頁面，而不是 widget。',
	'The first three steps are complete and the wizard opens on the induction: request a slot, see the office decline 17:00, cancel, and finish.': '前三個步驟都已完成，精靈直接開在新手導覽：預約時段、看櫃台婉拒 17:00、取消，然後完成。',
	'A valid wizard that opens on the induction step with nothing filled in. Going forward is refused by the Methods (a Method failure, nothing changes); going back works.': '一份有效的精靈，直接開在新手導覽這一步，什麼都還沒填。往前會被 Method 拒絕（Method failure，什麼都不會改變）；往回則可以。',
	'The default with four deliberate mistakes in four widgets: a minimum above the number of options, an acknowledged rule that does not exist, an induction day that is not a real date and a start step beyond the last. Each is a located diagnostic.': '預設範例，但四個 widget 各有一個刻意的錯誤：最少選取數超過選項數量、一條不存在的規則被設為已確認、一個不是真實日期的導覽日，以及超出最後一步的起始步驟。每一個都是有位置的 diagnostic。',

	// Tutorial confirmation
	'Starting the tutorial will load the Onboarding teaching example and replace your unapplied changes.': '開始教學會載入引導精靈教學範例，並取代你尚未套用的變更。',

	// Tutorial script
	'This is the Onboarding showcase': '這是新成員引導精靈範例',
	'This is a new-member onboarding wizard: four steps, each a widget, under one Onboarding root.': '這是一個新成員引導精靈：四個步驟，每個都是 widget，全都在同一個 Onboarding 根 widget 底下。',
	'This is a new-member onboarding wizard: four steps, each a widget, under one Onboarding root. The page around the widgets is the host: it listens to their Events, does the waiting for a booking office, and writes the answers back. The rest of this tour is about that line between the widgets and the host.': '這是一個新成員引導精靈：四個步驟，每個都是 widget，全都在同一個 Onboarding 根 widget 底下。widget 周圍的頁面就是 host：它監聽 widget 的 Events、替預約櫃台負責等待，並把答案寫回去。這份導覽接下來都在講 widget 與 host 之間的這條界線。',
	'Events are declared, and the host listens': 'Events 要先宣告，由 host 來監聽',
	'Open Selected widget and look at the Events of the induction step.': '打開 Selected widget，看看新手導覽這一步宣告的 Events。',
	'Two plugins declare Events: Onboarding (stepChanged, completed) and InductionStep (slotRequested, slotConfirmed, slotDeclined, slotCancelled). An Event is a public notification with a typed payload, emitted by a Method that lists it in emits. A widget cannot subscribe to an Event: only the host can, and it does, through runtime.getWidget(id).events.<name>.subscribe(). The Events tab of this Lab listens too, from outside the page.': '有兩個 plugin 宣告了 Events：Onboarding（stepChanged、completed）和 InductionStep（slotRequested、slotConfirmed、slotDeclined、slotCancelled）。Event 是帶有型別 payload 的公開通知，由在 emits 中列出它的 Method 發出。widget 不能訂閱 Event，只有 host 可以，而這個頁面正是透過 runtime.getWidget(id).events.<name>.subscribe() 來訂閱。這個 Lab 的 Events 分頁也在監聽，只是站在頁面之外。',
	'See the declared Events in Selected widget': '在 Selected widget 查看宣告的 Events',
	'Open the Events tab': '打開 Events 分頁',
	'A move that emits an Event': '會發出 Event 的一步',
	'Try it: fill in your name and an e-mail address, then press Next. Keep the Events tab open.': '試試看：填入你的姓名和電子郵件，然後按「下一步」。請讓 Events 分頁保持開啟。',
	'Next wrote State current and emitted stepChanged, in one call. In the Events tab the entry carries its payload: the step it left and the step it entered, and how. The page heard the same Event: its activity list says so, and it moved focus to the new step\'s heading. Next is a writing, emitting Method, so Core marks it W and E in Relations, and no Property may depend on it.': 'Next 在一次呼叫中寫入了 State current，並發出 stepChanged。在 Events 分頁裡，這筆項目帶有它的 payload：離開的步驟、進入的步驟，以及移動的方式。頁面也聽到了同一個 Event：它的活動清單會記下，並把焦點移到新步驟的標題。Next 是會寫入、也會發出 Event 的 Method，所以 Core 在 Relations 裡把它標成 W 和 E，任何 Property 都不能依賴它。',
	'See next() in Selected widget': '在 Selected widget 查看 next()',
	'A refused move is a Method failure': '被拒絕的操作是 Method failure',
	'Open the Examples menu and load "Deep link — opens on step 4, nothing filled in".': '打開「範例」選單，載入「深層連結——直接開在第 4 步，什麼都還沒填」。',
	'The wizard opened on the last step with nothing filled in. Press Finish: it is refused. Nothing changed and nothing was emitted, so there is no Event. What happened is the Method\'s diagnostic, invalid-method-result with reason steps-incomplete: the Events tab lists it as a Method failure (a different kind of entry from an Event), and Selected widget shows it on the finish() row as "Last call failed". The page explains the reason in its own words in its one alert. Finish stays refused until every step is complete, and the next successful call of a Method replaces its failure.': '精靈直接開在最後一步，什麼都還沒填。按「完成」：會被拒絕。什麼都沒有改變，也沒有發出任何東西，所以沒有 Event。發生的是 Method 的 diagnostic：invalid-method-result，reason 是 steps-incomplete。Events 分頁會把它列為 Method failure（和 Event 是不同種類的項目），Selected widget 則在 finish() 那一列顯示「上次呼叫失敗」。頁面用自己的話在唯一的警示訊息裡說明原因。在每個步驟都完成之前，「完成」都會被拒絕，而 Method 下一次成功的呼叫會取代它先前的失敗。',
	'See finish() in Selected widget': '在 Selected widget 查看 finish()',
	'Arguments are validated before the Method runs': '引數會在 Method 執行前先驗證',
	'Try it: type 1.5 into "Go to step number" and press Go, then 9, then 2.': '試試看：在「前往步驟編號」輸入 1.5 並按「前往」，接著輸入 9，再輸入 2。',
	'Type 1.5 and press Go: invalid-method-arguments with reason not-a-whole-number. validateArgs refused it, so execute never ran. Type 9: the argument is a whole number, so it passes, but execute finds there is no such step, and that is invalid-method-result with reason no-such-step. validateArgs sees only the arguments and the config, never the Blueprint or the other widgets, so a rule that needs them is checked in execute. Type 2 while the steps before it are incomplete: step-locked, because the read-only Method canEnter, which goTo calls, says no. In the Events tab each one is a Method failure; the page only translates the reason.': '輸入 1.5 並按「前往」：invalid-method-arguments，reason 是 not-a-whole-number。validateArgs 拒絕了它，所以 execute 根本沒有執行。輸入 9：這個引數是整數，所以通過驗證，但 execute 發現沒有這個步驟，那就是 invalid-method-result，reason 是 no-such-step。validateArgs 只看得到引數和 config，看不到 Blueprint 或其他 widget，所以需要它們的規則要在 execute 裡檢查。在前面的步驟還沒完成時輸入 2：step-locked，因為 goTo 呼叫的唯讀 Method canEnter 回答了「不行」。在 Events 分頁裡每一個都是 Method failure；頁面只是把 reason 翻譯出來。',
	'See goTo() in Selected widget': '在 Selected widget 查看 goTo()',
	'See canEnter() in Selected widget': '在 Selected widget 查看 canEnter()',
	'Booking is asynchronous work': '預約是非同步的工作',
	'Open the Examples menu and load "Ready to book — only the induction left".': '打開「範例」選單，載入「準備預約——只剩新手導覽」。',
	'The first three steps are already complete, so the wizard opens on the induction. Core is synchronous on purpose: a Method cannot wait for anything, a Promise from a callback is a contract violation, and the emit and deps callables of a Method stop working when it returns. So the widget will never wait for the booking. It records the request in State and emits slotRequested; the page, as the host, does the waiting.': '前三個步驟都已完成，所以精靈直接開在新手導覽。Core 刻意設計成同步的：Method 不能等待任何東西，callback 回傳 Promise 違反契約，而且 Method 的 emit 與 deps 在 Method 回傳之後就不能再用。所以 widget 永遠不會等待預約的結果。它把請求記錄在 State 並發出 slotRequested；等待的工作由頁面這個 host 負責。',
	'The widget asks, the host waits': 'widget 提出請求，host 負責等待',
	'Try it: choose a date (5 December 2026), keep 10:00 and press Request this slot.': '試試看：選擇日期（2026 年 12 月 5 日），保持 10:00，然後按「預約這個時段」。',
	'requestSlot returned at once, with a ticket, after writing status requesting and emitting slotRequested (Events tab). The host heard it and asked the simulated booking office, which answered about a second and a half later; the host then called settleBooking(ticket, outcome), an ordinary synchronous Method call from outside Core, which wrote the reference and emitted slotConfirmed. Nothing inside Core waited. Try the 17:00 slot too: the office declines it (slotDeclined). Request a date that is not offered, or with no date at all: invalid-method-arguments, from the config.': 'requestSlot 寫入 status requesting 並發出 slotRequested（見 Events 分頁）後，馬上帶著一個 ticket 回傳。host 聽到後向模擬的預約櫃台詢問，櫃台大約一秒半之後回覆；host 接著呼叫 settleBooking(ticket, outcome)，這是從 Core 之外發出的一般同步 Method 呼叫，它寫入預約編號並發出 slotConfirmed。Core 裡面沒有任何東西在等待。也試試 17:00 的時段：櫃台會婉拒（slotDeclined）。要求一個沒有提供的日期，或完全不選日期：會得到 invalid-method-arguments，依據來自 config。',
	'See requestSlot() in Selected widget': '在 Selected widget 查看 requestSlot()',
	'A late answer is ignored': '遲到的回覆會被忽略',
	'Try it: cancel the booking. If the office declined your last request (17:00), there is nothing to cancel: request 10:00 again first.': '試試看：取消預約。如果櫃台婉拒了你上一次的預約（17:00），就沒有可以取消的預約：請先再預約一次 10:00。',
	'Cancelling emitted slotCancelled. Every request has a ticket, kept in State, and settleBooking applies an answer only if its ticket is still the newest. Cancelling a request that is still waiting makes the host recall it, so no answer comes. If the office cannot recall a request, the answer still arrives later, and settleBooking returns false and changes nothing. Switch off "The office can recall a cancelled request", request a slot, cancel it, request another and let the office answer: the page\'s activity list says the first answer was ignored. Core\'s guide calls this the guard for work that cannot be cancelled.': '取消時發出了 slotCancelled。每個請求都有一個存在 State 裡的 ticket，settleBooking 只有在回覆的 ticket 仍是最新的時候才會套用。取消仍在等待中的請求時，host 會撤回它，所以不會有回覆送來。如果櫃台無法撤回請求，回覆之後仍會送達，而 settleBooking 會回傳 false 且不改變任何東西。關掉「櫃台可以撤回已取消的請求」，預約一個時段、取消它、再預約另一個，然後讓櫃台回覆：頁面的活動清單會說第一個回覆被忽略了。Core 的指南把這稱為無法取消的工作所需要的防護。',
	'See settleBooking() in Selected widget': '在 Selected widget 查看 settleBooking()',
	'Dependencies (Relations, Graph) = the declared chain between widgets, with W and E on the Methods that write State or emit · Selected widget = one widget\'s declaration, Events and Runtime values, with each Method\'s last failure · Runtime = every widget\'s State and Properties · Events = Events and Method failures as they happen · Implementation = the plugin, host and renderer code behind this widget type.': '相依性（Relations、關係圖）= widget 之間已宣告的鏈，會在寫入 State 或發出 Event 的 Method 上標出 W 與 E · Selected widget = 一個 widget 的宣告、Events 與 Runtime 的值，以及每個 Method 最近一次的失敗 · Runtime = 每個 widget 的 State 與 Properties · Events = 即時的 Events 與 Method failure · Implementation = 這個 widget type 背後的 plugin、host 與 renderer 程式碼。',
	'You have seen Events with a host listener, refused moves as Method failures, argument validation and async work kept at the host.': '你已經看過由 host 監聽的 Events、以 Method failure 呈現的被拒絕操作、引數驗證，以及留在 host 的非同步工作。',
	'Edit the JSON (add a safety rule, change the offered days) and press Apply, load "Draft with mistakes" to see config diagnostics, or open the Implementation of InductionStep to read the host that does the waiting.': '可以編輯 JSON（新增一條安全規則、改變提供的日期）後按「套用」，載入「有錯誤的草稿」查看 config diagnostics，或打開 InductionStep 的 Implementation，閱讀負責等待的 host。',
}

export function translateOnboardingMessage(locale: LabLocale, source: string): string | undefined {
	return locale === 'zh-TW' ? zhTWOnboardingMessages[source] : undefined
}
