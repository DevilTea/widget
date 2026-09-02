/**
 * The CRM tour's 6-step script (diagnostic #25 P4 Scope A). Same staged do -> observe -> name structure as
 * `survey-script.ts`, against the `crm-default` preset's deterministic eight-deal seed set
 * (`showcases/crm/domain.ts`'s `seedDeals` — "Aurora Systems" is `deal-1`, seeded at stage `lead`). The
 * deterministic-start policy the OWNER locked for the Survey tour (diagnostic #25 OWNER decision) applies to
 * this tour by direct extension: starting/restarting the CRM tour always reloads `crm-default` through
 * the normal preset/Apply pipeline (`use-tutorial.ts`'s `loadTourDefault()`), with the same dirty-draft
 * confirmation — this script is authored/tested against that known starting state, never adapted to
 * arbitrary Runtime state.
 *
 * Required teaching moments (diagnostic #25 Scope A "Sales Pipeline CRM should at least teach"): search/filter
 * State + derived Properties (step 2), row selection -> detail coordination via `Table.selectedRowId`
 * (step 3), Change stage -> Modal -> Method mutation with dependent-view recompute (step 4), an optional
 * pointer to semantic-only widgets (step 5), and a condensed hand-back (step 6) that deliberately does
 * NOT repeat Survey's step 8 six-view walkthrough verbatim (diagnostic #25 P4 ask: "avoid duplicating ... one
 * condensed step is fine").
 *
 * Step 4's two stages are NOT split into two separate steps, and this is a deliberate correction of an
 * earlier draft that DID split them (open the dialog / pick a stage + Save, as two steps each with its
 * own Next click in between): `ModalRenderer.vue`'s dialog is a REAL native `showModal()` dialog, which
 * makes the entire rest of the document — including this tutorial rail, a sibling of Dockview outside
 * the modal — `inert` while it is open. A visitor cannot click the rail's Next button while the Change
 * stage dialog is open, so a step design that requires exactly that is unusable, not merely awkward.
 * Keeping both stages inside ONE step means Next is only ever clicked after the dialog has fully closed
 * (via Save, or a Cancel/Escape detour the copy explicitly invites) — both stages' predicates are
 * satisfied via passive Runtime observation while the dialog is open (their reveal text becomes visible
 * in the — currently non-interactive-but-still-visible, `inert` does not hide content — rail), and Next
 * only needs to be clickable again once the visitor closes the dialog, which they must do anyway to
 * continue using the rest of the workbench.
 *
 * Tour-end stage mutation: step 4 leaves Aurora Systems' stage changed from its seed value, and this
 * script makes no attempt to reset it before Finish. This is intentional, not an oversight — see this
 * module's own header note below the step list for the reasoning (deterministic restart already reloads
 * `crm-default` from scratch, so nothing is preserved across a restart/re-entry regardless).
 */

import type { TutorialScript } from './types'

export const CRM_TOUR_ID = 'crm'

/**
 * Narrow, local shape-check for one seed deal's `id`/`stage` fields — deliberately not importing
 * `showcases/crm/domain.ts`'s own `Deal`/`isDeal` here: this script only ever needs to read two fields
 * off a passively-observed `unknown` State value, and staying decoupled from the showcase's own domain
 * module keeps this file's dependency surface the same shape as `survey-script.ts`'s (ad hoc structural
 * checks, no showcase-plugin imports).
 */
function findDealById(deals: unknown, id: string): { readonly stage: unknown } | undefined {
	if (!Array.isArray(deals))
		return undefined
	return (deals as readonly unknown[]).find((deal): deal is { readonly id: unknown, readonly stage: unknown } =>
		typeof deal === 'object' && deal !== null && (deal as { id?: unknown }).id === id)
}

/**
 * `true` when `deals` (an array of deal-shaped records) contains one with `id`. Reuses the same
 * structural shape `findDealById` already checks — a deal record always carries `id`, whether read from
 * `DealStore.deals` or `DealQuery.filteredDeals` (a filtered projection of the same records).
 */
function dealsInclude(deals: unknown, id: string): boolean {
	return findDealById(deals, id) !== undefined
}

export const crmTourScript: TutorialScript = {
	id: CRM_TOUR_ID,
	observationTargets: [
		{ widgetId: 'deal-search', member: { type: 'state', key: 'value' } },
		{ widgetId: 'deal-query', member: { type: 'property', key: 'filteredDeals' } },
		{ widgetId: 'deal-table', member: { type: 'state', key: 'selectedRowId' } },
		{ widgetId: 'stage-modal', member: { type: 'state', key: 'open' } },
		{ widgetId: 'deal-store', member: { type: 'state', key: 'deals' } },
	],
	steps: [
		{
			id: 'orient',
			title: 'This is the Sales Pipeline CRM',
			target: 'preview',
			onEnter: actions => actions.setFocus('deal-store'),
			stages: [{
				prompt: 'This is the Sales Pipeline CRM — a deal-tracking dashboard over a shared set of deals.',
				reveal: 'This is the Sales Pipeline CRM — a deal-tracking dashboard over a shared set of deals.',
			}],
		},
		{
			id: 'search',
			title: 'Search, stored as State',
			target: 'crm-search',
			onEnter: actions => actions.setFocus('deal-search', { type: 'state', name: 'value' }),
			// Merge-gate review round 2, blocker 1: "Aurora" is the required action, not merely an example
			// — the predicate below is pinned to it (via the filtered SET still containing `deal-1`,
			// rather than a bare "any narrowing query" check). `DealQuery.filteredDeals` is a real
			// case-insensitive substring filter over company/contact/owner, so an EQUALLY valid search
			// like "Borealis" would also narrow the table — but it would filter Aurora Systems OUT, and
			// the very next step is hard-pinned to selecting exactly that row (`deal-1`). Accepting any
			// narrowing search here would let the tour advance into a state its own next instruction
			// cannot be completed from, without the visitor independently realizing they must undo it.
			stages: [{
				prompt: 'Try it: search for "Aurora".',
				isComplete: (reader) => {
					const filteredDeals = reader.readProperty('deal-query', 'filteredDeals')
					if (filteredDeals?.status !== 'completed' || !filteredDeals.result.ok)
						return false
					const deals = filteredDeals.result.value
					// Narrowing occurred (fewer than all 8 seed deals are visible) AND the row the next
					// step requires (Aurora Systems, `deal-1`) is still among them.
					return Array.isArray(deals) && deals.length < 8 && dealsInclude(deals, 'deal-1')
				},
				reveal: 'The table narrowed and the Visible deals KPI updated together. Your search is stored as State on the deal-search widget; the table and KPI are Properties — DealQuery.filteredDeals/count — derived from that same State, recomputed automatically.',
			}],
			links: [{
				id: 'see-in-runtime',
				label: 'See it in Runtime',
				run: (actions) => {
					actions.setFocus('deal-search', { type: 'state', name: 'value' })
					actions.activateTab('runtime')
				},
			}],
		},
		{
			id: 'select-row',
			title: 'Selecting a row, coordinated',
			target: 'crm-table',
			onEnter: actions => actions.setFocus('deal-table', { type: 'state', name: 'selectedRowId' }),
			stages: [{
				prompt: 'Try it: select the Aurora Systems row — click it, or focus it and press Enter or Space.',
				isComplete: reader => reader.readState('deal-table', 'selectedRowId') === 'deal-1',
				reveal: 'The detail panel now shows Aurora Systems. Selecting a row writes Table.selectedRowId — one piece of State that both marks the current row and drives DetailPanel.record, a Property reading that same selection.',
			}],
		},
		{
			id: 'change-stage',
			title: 'A Method opens a dialog; another mutates — and everything recomputes',
			target: 'crm-change-stage-button',
			onEnter: actions => actions.setFocus('deal-stage-form', { type: 'method', name: 'open' }),
			// Kept as ONE step with two stages, not two steps — see this module's own header for why: the
			// Change stage dialog is a real native `showModal()` dialog, which makes the rest of the
			// document (including this rail) `inert` while open, so Next can only ever be clicked once it
			// has closed. Both stages below reveal via passive Runtime observation while the dialog may
			// still be open; only the STEP's own Next needs the dialog already closed, which stage 2's own
			// completion (Save) already guarantees.
			stages: [
				{
					prompt: 'Try it: click Change stage.',
					isComplete: reader => reader.readState('stage-modal', 'open') === true,
					reveal: 'The dialog opened. Change stage invoked DealStageForm.open() — a Method that loaded the current stage into the New stage field and told the Modal to open.',
				},
				{
					prompt: 'Pick a new stage, then press Save. (Cancel or Escape back out first if you like — nothing saves until Save is pressed.)',
					isComplete: (reader) => {
						const deal = findDealById(reader.readState('deal-store', 'deals'), 'deal-1')
						// `deal-1` (Aurora Systems) seeds at stage `lead` — any other stage proves Save landed.
						return deal !== undefined && deal.stage !== 'lead'
					},
					reveal: 'Aurora Systems\' stage changed — and the table badge, the KPIs, and the stage chart all recomputed together. Save invoked DealStageForm.save(), which invoked DealStore.updateStage(): one Method call, many Properties reading the same store State.',
				},
			],
		},
		{
			id: 'semantic-only-widgets',
			title: 'Some widgets render nothing',
			target: null,
			onEnter: actions => actions.setFocus('deal-query'),
			stages: [{
				prompt: 'DealStore and DealQuery own the rules — take a look at how, whenever you like.',
				reveal: 'DealStore and DealQuery own the search/filter/aggregation rules and the mutation you just made — but neither renders anything in Preview. Open Graph or Implementation to see them.',
			}],
			links: [
				{ id: 'view-graph', label: 'Graph', run: actions => actions.activateTab('graph') },
				{ id: 'view-implementation', label: 'Implementation', run: actions => actions.openImplementation() },
			],
		},
		{
			id: 'hand-back',
			title: 'You now know the CRM pipeline',
			target: null,
			finishLabel: 'Finish',
			stages: [{
				prompt: 'You\'ve now seen State, Properties, row-selection coordination, and a Method-driven mutation.',
				reveal: 'State, Properties, row-selection coordination, and a Method-driven mutation recomputing three views at once — the same semantic model as the Survey tour, applied to a dashboard instead of a form. Explore Blueprint, Runtime, or Graph anytime, or open Implementation for any widget.',
			}],
		},
	],
}

/**
 * Tour-end stage-mutation handling (diagnostic #25 P4 ask: "reset any mutated stage at tour end OR document
 * why leaving it is fine"): this script deliberately does NOT reset Aurora Systems' stage back to `lead`
 * before/at Finish. Reasons, matching the OWNER-locked policy for Survey ("the tutorial does not
 * preserve/restore the previous Runtime or draft after completion/cancellation"):
 *
 * 1. A restart (or a fresh Start after completion) always reloads `crm-default` from scratch through the
 *    normal preset/Apply pipeline (`use-tutorial.ts`'s `loadTourDefault()`) — the mutated stage from a
 *    PRIOR run is never visible to a later run's own predicates, which are authored against the freshly
 *    reloaded seed data every time, exactly like Survey's own script.
 * 2. Resetting it mid-tour (e.g. a synthetic extra step that calls `DealStore.reset()` right before
 *    Finish) would itself be an extra, unexplained Method invocation with no do -> observe -> name
 *    pairing of its own — a housekeeping action bolted onto the teaching script, not a teaching moment.
 * 3. Leaving the mutation visible after Finish is arguably a FEATURE, not a defect: it is the same "your
 *    interaction really changed the shared deal data" fact the tour just taught, still visible in the
 *    workbench after hand-back — consistent with "never blocks ordinary Lab use", and the header's
 *    "Reset data" button (`DealStore.reset()`) is the same one-click, already-familiar undo any visitor
 *    who wants a clean slate for their OWN further exploration already has, tour or no tour.
 */
