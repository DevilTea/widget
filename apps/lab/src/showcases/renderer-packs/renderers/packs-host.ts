/**
 * The host of one Runtime of the settings page: what is a decision of the PAGE, not of any widget.
 *
 * - **Which renderer pack draws the page** (`choice`: hand-written, Nuxt UI or both side by side). It is not widget State: the
 *   Runtime panel does not show it, a Method cannot change it, and switching it never touches the Runtime. The same Runtime stays
 *   mounted; the controls of the other pack mount over the same State, so whatever was typed is still there.
 * - **Which pack owns what must exist once.** Side by side, both panes draw the same widgets from the same State. A page has one
 *   `role="alert"`, one `role="status"` and one open confirmation, so exactly one pack is the *live* one (`isLive`: the first
 *   visible pack), and the open confirmation of an action belongs to the pack whose button asked (`noteAsker`, `ownsDialog`).
 *
 * The host owns no Runtime and never disposes one: `RendererPacksRenderer` (`./index.ts`) creates it for a Runtime and drops it
 * with the page.
 */

import type { ComputedRef, InjectionKey, Ref } from 'vue'
import { computed, shallowRef } from 'vue'

export type PackId = 'hand' | 'nui'
export type PackChoice = PackId | 'both'

export const PACK_CHOICES = ['hand', 'nui', 'both'] as const satisfies readonly PackChoice[]

export function isPackChoice(value: unknown): value is PackChoice {
	return typeof value === 'string' && (PACK_CHOICES as readonly string[]).includes(value)
}

export interface PacksHost {
	readonly choice: Readonly<Ref<PackChoice>>
	/** The packs that are drawn now, in pane order (hand-written first). */
	readonly visible: ComputedRef<readonly PackId[]>
	setChoice: (choice: PackChoice) => void
	/** Whether `pack` is the one whose live regions (`role="alert"`, `role="status"`) exist: the first visible pack. */
	isLive: (pack: PackId) => boolean
	/** Remembers which pack's button opened the confirmation of `widgetId`. */
	noteAsker: (widgetId: string, pack: PackId) => void
	/** Whether `pack` draws the open confirmation of `widgetId`: its asker while that pack is visible, otherwise the live pack. */
	ownsDialog: (widgetId: string, pack: PackId) => boolean
}

export function createPacksHost(initial: PackChoice = 'hand'): PacksHost {
	const choice = shallowRef<PackChoice>(initial)
	const askers = new Map<string, PackId>()
	const visible = computed<readonly PackId[]>(() => choice.value === 'both' ? ['hand', 'nui'] : [choice.value])
	const owner = (widgetId: string): PackId => {
		const asker = askers.get(widgetId)
		return asker !== undefined && visible.value.includes(asker) ? asker : visible.value[0]!
	}
	return {
		choice,
		visible,
		setChoice: (next) => {
			choice.value = next
		},
		isLive: pack => visible.value[0] === pack,
		noteAsker: (widgetId, pack) => {
			askers.set(widgetId, pack)
		},
		ownsDialog: (widgetId, pack) => owner(widgetId) === pack,
	}
}

export const PacksHostKey: InjectionKey<PacksHost> = Symbol('widget-lab:renderer-packs-host')
