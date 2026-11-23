import type { LabLocale } from './locale'

/**
 * Lab-owned presentation copy of the Legacy document repair showcase (issue #230): the Examples menu entries (showcase
 * name, preset names and descriptions) and the guided tour. English source strings are the message ids, exactly as in
 * `messages.ts`; the drafts' own content is source-owned (the stored legacy documents) and the Preview's own chrome is the
 * showcase's (`showcases/document-repair/messages.ts`), so neither goes through this table.
 *
 * Widget vocabulary (State, Property, Method, Event, Runtime, Blueprint, Selected widget as a name of a tab) stays English,
 * as everywhere else in the zh-TW Lab. API names (createWidgetDocument, applyPatch, SourcePatch, expectedRevision, test,
 * getSourcePath), diagnostic and failure codes and reasons are never translated.
 */
export const zhTWDocumentRepairMessages: Readonly<Record<string, string>> = {
	// Examples menu
	'Legacy document repair': '舊版文件修復',
	'Default — four drafts from older versions': '預設——四份來自舊版本的草稿',
	'A valid repair desk with four drafts of the notice board that 1.x, 2.x and 3.x of the app saved, one of them with a widget type the app has no repair rule for. Open one and repair it step by step.': '一個有效的修復桌，裡面有四份公告欄草稿，分別由 1.x、2.x 與 3.x 版的應用程式存下來，其中一份含有應用程式沒有修復規則的 widget 類型。打開其中一份，一步一步修復它。',
	'The repair desk itself is invalid, in its own document: an app version that is not a version, a draft without a stored document, a draft saved with an unknown format version and a draft without a title. Each is a located diagnostic.': '修復桌本身就是無效的，問題出在它自己的文件裡：不是版本號的應用程式版本、沒有儲存文件的草稿、以未知格式版本儲存的草稿，以及沒有標題的草稿。每一個都是有位置的診斷。',

	// Tutorial confirmation
	'Starting the tutorial will load the Legacy document repair teaching example and discard the JSON that can\'t be applied yet.': '開始教學會載入舊版文件修復教學範例，並捨棄目前還無法套用的 JSON。',

	// Tutorial script
	'This is the Legacy document repair showcase': '這是舊版文件修復範例',
	'This is a notice-board app at format v3, with four drafts that older versions of the app saved.': '這是一個格式為 v3 的公告欄應用程式，裡面有四份舊版本應用程式存下來的草稿。',
	'This is a notice-board app at format v3, with four drafts that older versions saved. The Lab\'s own document is the repair desk (RepairDesk and SavedDraft widgets); each draft keeps the stored document as its config, and the notice board is a second System that lives inside the showcase. Core does not migrate, version, repair or quarantine anything. The repair rules are the application\'s own code, and nothing is saved anywhere: the drafts are fixtures in memory.': '這是一個格式為 v3 的公告欄應用程式，裡面有四份舊版本存下來的草稿。Lab 自己的文件是修復桌（RepairDesk 與 SavedDraft widget）；每份草稿把儲存的文件放在自己的 config 裡，而公告欄是住在這個範例裡的第二個 System。Core 不會遷移、標記版本、修復或隔離任何東西。修復規則是應用程式自己的程式碼，而且任何東西都不會被儲存：草稿只是放在記憶體裡的固定資料。',
	'Core says where a stored draft is wrong': 'Core 會告訴你儲存的草稿哪裡有問題',
	'Open the "The stored draft, as Core sees it" details of the draft saved with 1.x, and read its diagnostics and nodes.': '展開以 1.x 儲存的那份草稿的「Core 眼中的原始草稿」，讀一讀它的診斷與節點。',
	'The findings Property compiles the stored source with the notice board System, and the page lists what Core reported: each diagnostic has a code and the path of its node inside the source, from blueprint.getSourcePath(node), which is also a valid SourcePatch path. The old slot "items" is a raw-slot placement: Core keeps its children as recovered nodes, but they stay invalid. The Banner nodes are unresolved (unknown type), and they keep their id and type as hints; the one without an id has only its type as a hint.': 'findings Property 會用公告欄 System 編譯儲存的 source，頁面列出 Core 回報的內容：每個診斷都有 code，以及它的節點在 source 裡的路徑（來自 blueprint.getSourcePath(node)，這同時也是有效的 SourcePatch 路徑）。舊的 slot「items」是 raw-slot 位置：Core 會把它的子節點當作還原出來的節點保留，但它們仍然無效。Banner 節點是未解析的（未知類型），並以 id 和 type 作為提示保留下來；沒有 id 的那一個只剩 type 可以當提示。',
	'See findings in Selected widget': '在 Selected widget 查看 findings',
	'Open the Blueprint tree': '打開 Blueprint 樹',
	'Opening a draft works on a copy': '開啟草稿時是在副本上作業',
	'Press "Open in the app" on the draft saved with 1.x.': '在以 1.x 儲存的草稿上按「在應用程式中開啟」。',
	'The app called createWidgetDocument with a structuredClone of the stored source: the document is at revision 0. Core never mutates a source, but it keeps the object it is given by reference as revision 0, and every later revision shares its untouched parts, so an object that is changed after it was handed over would corrupt every revision. The stored draft is the app\'s own model and the app may keep editing it, so the host hands over a copy and the two share nothing. The draft\'s State revision, appRevision and repaired mirror the session: Selected widget and Runtime show them.': '應用程式用儲存 source 的 structuredClone 呼叫了 createWidgetDocument：文件在 revision 0。Core 從不修改 source，但它會以參照保留拿到的物件作為 revision 0，之後每個 revision 也都共用沒有改動的部分，所以物件在交出去之後才被改動，會讓每個 revision 都跟著壞掉。儲存的草稿是應用程式自己的模型，應用程式可能繼續編輯它，所以 host 交出的是副本，兩者不共用任何東西。草稿的 State revision、appRevision 與 repaired 會反映這個 session：Selected widget 與 Runtime 都看得到。',
	'See the draft State in Selected widget': '在 Selected widget 查看草稿的 State',
	'The plan is the application\'s policy': '計畫是應用程式自己的政策',
	'Read the plan in the editing session, and open "Show the patch" on a step.': '讀一讀編輯 session 裡的計畫，並對其中一個步驟展開「顯示 patch」。',
	'The plan is an ordered list of steps, computed by planRepair from the document\'s current snapshot and the version the draft was saved with. Core knows nothing about versions: which patch repairs which legacy shape is the application\'s decision. Every step is a SourcePatch whose first operations are test guards for the value the step was planned against, so a step fails as a whole, with test-failed, if the document is no longer what it expected. The first step moves the slot "items" to "notices"; the last replaces a whole array element, the repair floor for a node that has no id.': '計畫是一串有順序的步驟，由 planRepair 依文件目前的 snapshot 與草稿儲存時的版本算出來。Core 完全不知道版本：哪個 patch 修復哪種舊格式，是應用程式的決定。每個步驟都是一個 SourcePatch，它最前面的操作是 test 檢查，確認的是規劃這個步驟時所看到的值，所以只要文件已經不是它預期的樣子，整個步驟就會以 test-failed 失敗。第一個步驟把 slot「items」搬到「notices」；最後一個步驟換掉整個陣列元素，這是沒有 id 的節點能修復的底線。',
	'See plan in Selected widget': '在 Selected widget 查看 plan',
	'One step is one patch': '一個步驟就是一個 patch',
	'Press "Apply next step" once.': '按一次「套用下一步」。',
	'The app called applyPatch(step.patch, { expectedRevision: 0 }) and Core answered { ok: true, changed: true }: revision 1. The document listener, which hears every commit as (snapshot, { previous, patch }), logged it with its number of operations. The app then read the new snapshot and planned again, so the diagnostics and the plan changed: the slot is "notices" now and the plan has one step fewer. applyPatch is copy-on-write: Core built revision 1 and left revision 0 as it was, and the document is a copy of the stored draft anyway.': '應用程式呼叫了 applyPatch(step.patch, { expectedRevision: 0 })，Core 回答 { ok: true, changed: true }：revision 1。文件 listener 會以 (snapshot, { previous, patch }) 的形式聽到每一次 commit，並把它連同操作數量記錄下來。接著應用程式讀取新的 snapshot 並重新規劃，所以診斷與計畫都變了：slot 現在是「notices」，計畫少了一個步驟。applyPatch 是 copy-on-write：Core 建出 revision 1，revision 0 維持原樣，而且文件本來就是儲存草稿的副本。',
	'Someone else saves first': '有人搶先儲存了',
	'Press "Another editor saves".': '按「另一位編輯者儲存」。',
	'A second writer applied a small valid edit (the board title) to the same document, without an expected revision. The document moved to a new revision and the log says who saved it, but the app did not read it: State appRevision is still the revision the app planned from, so it is now behind revision.': '第二位寫入者對同一份文件做了一個小而有效的編輯（公告欄標題），而且沒有帶 expected revision。文件前進到新的 revision，紀錄也寫明是誰儲存的，但應用程式並沒有讀取它：State appRevision 仍是應用程式規劃時所依據的 revision，所以它現在落後 revision 了。',
	'A stale revision is refused': '過期的 revision 會被拒絕',
	'Now press "Apply next step".': '現在按「套用下一步」。',
	'The app sent its step with expectedRevision set to the revision it planned from, and Core refused it before evaluating any operation: document-revision-conflict, carrying expectedRevision and actualRevision. Nothing was applied, so the document did not change. The page\'s one alert explains it, and the result shows the failure code. This is how a host avoids overwriting an edit it has not seen: the revision check is the application\'s to supply, and Core enforces it.': '應用程式送出步驟時，把 expectedRevision 設成它規劃時所依據的 revision，而 Core 在評估任何操作之前就拒絕了它：document-revision-conflict，並附上 expectedRevision 與 actualRevision。什麼都沒有套用，所以文件沒有改變。頁面上唯一的 alert 說明了原因，結果欄也顯示失敗的 code。host 就是這樣避免蓋掉自己還沒看過的編輯：revision 的檢查由應用程式提供，由 Core 負責執行。',
	'Re-read, then plan again': '重新讀取，再重新規劃',
	'Press "Re-read and re-plan".': '按「重新讀取並重新規劃」。',
	'The app read the current snapshot and ran planRepair on it again. Because the plan is a pure function of the source, it did not need to know what the other editor changed: the steps that still apply are the same, and the next patch carries the new revision. The stale-revision notice is gone, and the next step is accepted.': '應用程式讀取了目前的 snapshot，並對它重新執行 planRepair。因為計畫是 source 的純函式，它不需要知道另一位編輯者改了什麼：仍然適用的步驟都一樣，下一個 patch 會帶上新的 revision。過期 revision 的提示消失了，下一個步驟也會被接受。',
	'Apply the rest of the plan': '套用計畫剩下的部分',
	'Keep pressing "Apply next step" until the document is valid.': '持續按「套用下一步」，直到文件有效為止。',
	'The last step replaced the notice that had no id with a complete one, and the diagnostics list is empty: the Blueprint is valid. Only a valid Blueprint has createRuntime, so only now can the app create a Runtime for it.': '最後一個步驟把沒有 id 的公告換成完整的，診斷清單也空了：Blueprint 是有效的。只有有效的 Blueprint 才有 createRuntime，所以到現在應用程式才能為它建立 Runtime。',
	'Preview and export the repaired board': '預覽並匯出修復後的公告欄',
	'Press "Preview the repaired board", then "Export".': '按「預覽修復後的公告欄」，再按「匯出」。',
	'Preview created a Runtime of the notice board System from the valid Blueprint and rendered it with plain Vue components in a nested widget-vue root. Export shows the repaired JSON text: the slot is "notices", the type is "Notice", the style is kept in meta, the repeated id has a new one. Nothing was saved: a real application would write the exported text to its own storage, and Core has no part in that.': '預覽用有效的 Blueprint 建立了公告欄 System 的 Runtime，並用一般的 Vue 元件在巢狀的 widget-vue 根節點中渲染它。匯出則顯示修復後的 JSON 文字：slot 是「notices」，類型是「Notice」，樣式保留在 meta 裡，重複的 id 換成了新的。沒有任何東西被儲存：真正的應用程式會把匯出的文字寫進自己的儲存空間，而 Core 不參與其中。',
	'No rule, no Runtime': '沒有規則，就沒有 Runtime',
	'Open the draft "Open-day poll" and apply its one step.': '打開草稿「Open-day poll」，並套用它唯一的步驟。',
	'This draft holds a Poll widget that the application knows no rule for, so its plan has only the date step and the document stays invalid: the diagnostics list still has unknown-widget-type, and no preview is offered. Validity is all-or-nothing: Core creates no Runtime for an invalid document, runs no valid part of it and quarantines nothing. What to do with a draft nobody can repair is the application\'s decision.': '這份草稿含有應用程式沒有任何規則的 Poll widget，所以它的計畫只有日期那一步，文件仍然無效：診斷清單裡還有 unknown-widget-type，也不會提供預覽。有效性是全有或全無：Core 不會為無效的文件建立 Runtime，不會執行其中有效的部分，也不會隔離任何東西。沒有人能修復的草稿要怎麼處理，是應用程式的決定。',
	'Tools, beside the Preview: Blueprint tree = the repair desk\'s own widgets and diagnostics, not the notice board\'s · Selected widget = a draft\'s Properties findings and plan, and the State that mirrors the session · Runtime tree = every draft\'s State and Properties · Dependencies = this showcase has none between widgets: each draft is independent · Implementation = the plan, the host\'s session code and the notice board plugins behind these widgets.': '工具（在 Preview 旁開啟）：Blueprint 樹 = 修復桌自己的 widget 與診斷，不是公告欄的 · Selected widget = 草稿的 Properties findings 與 plan，以及反映 session 的 State · Runtime 樹 = 每份草稿的 State 與 Properties · Dependencies = 這個範例的 widget 之間沒有依賴：每份草稿各自獨立 · Implementation = 這些 widget 背後的計畫、host 的 session 程式碼與公告欄 plugin。',
	'You have seen diagnostics located in a stored document, a repair plan written by the application, patches guarded by test operations, a stale revision refused by Core and a draft that never gets a Runtime.': '你已經看過定位在儲存文件裡的診斷、由應用程式撰寫的修復計畫、以 test 操作把關的 patch、被 Core 拒絕的過期 revision，以及一份永遠得不到 Runtime 的草稿。',
	'Edit the JSON (change a draft\'s savedWith, or its stored source) and watch the Preview update, load "Draft with mistakes" to see config diagnostics in the desk itself, or open the Implementation of SavedDraft to read planRepair and the session code.': '編輯 JSON（改某份草稿的 savedWith 或它儲存的 source），看 Preview 跟著更新，載入「有錯誤的草稿」看修復桌自己的 config 診斷，或打開 SavedDraft 的 Implementation 閱讀 planRepair 與 session 的程式碼。',
}

export function translateDocumentRepairMessage(locale: LabLocale, source: string): string | undefined {
	return locale === 'zh-TW' ? zhTWDocumentRepairMessages[source] : undefined
}
