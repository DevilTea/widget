/**
 * What every renderer of BOTH packs needs to speak the host's language: the showcase's own messages, the document's
 * `{ "en", "zh-TW" }` texts, and the host (`PacksHost`) the page provides. All of it follows `useShowcaseHost().locale`.
 */

import type { I18nText, Mode } from '../domain'
import type { PacksMessageKey } from '../messages'
import type { PackId, PacksHost } from './packs-host'
import { computed, inject } from 'vue'
import { useShowcaseHost, useShowcaseMessages } from '../../../showcase-host'
import { fill, localize, resolveScheme } from '../domain'
import { packsMessages } from '../messages'
import { createPacksHost, PacksHostKey } from './packs-host'

export interface PacksText {
	readonly t: (key: PacksMessageKey) => string
	/** `t(key)` with its `{name}` markers filled in. */
	readonly tf: (key: PacksMessageKey, values: Readonly<Record<string, string | number>>) => string
	readonly text: (value: I18nText) => string
}

export function usePacksText(): PacksText {
	const host = useShowcaseHost()
	const { t } = useShowcaseMessages(packsMessages)
	return {
		t,
		tf: (key, values) => fill(t(key), values),
		text: value => localize(value, host.locale.value),
	}
}

/** The host the page frame provides to everything below it. */
export function requirePacksHost(): PacksHost {
	const host = inject(PacksHostKey, null)
	if (host === null)
		throw new Error('The page frame provides no PacksHost (RendererPacksRenderer does).')
	return host
}

/**
 * The page's host as one pack sees it. A renderer mounted without a page around it (a unit test of one component) gets a host
 * of its own with only its pack visible, so it is live and owns its dialogs.
 */
export function usePacksHost(pack: PackId): { readonly host: PacksHost, readonly live: () => boolean, readonly ownsDialog: (widgetId: string) => boolean } {
	const host = inject(PacksHostKey, null) ?? createPacksHost(pack)
	return {
		host,
		live: () => host.isLive(pack),
		ownsDialog: widgetId => host.ownsDialog(widgetId, pack),
	}
}

/** The colour scheme a pack draws in, from the page's Appearance mode and the host theme. */
export function useScheme(mode: () => Mode | null | undefined) {
	const host = useShowcaseHost()
	return computed(() => resolveScheme(mode() ?? 'auto', host.theme.value))
}
