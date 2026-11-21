/**
 * The Nuxt UI pack's own Vue app. The showcase's root renderer mounts a NESTED app into an element of the showcase root:
 *
 * - it installs `@nuxt/ui/vue-plugin` itself (the frame document has none: the Lab chrome's Nuxt UI lives in the shell document,
 *   and `styling-boundary.unit.test.ts` keeps the chrome's pipeline out of the frame);
 * - it wraps the pack in `UApp` with `portal` pointing at the overlay container inside the pack's root (`./portal.ts`), so no
 *   overlay is teleported to the frame's `<body>`;
 * - it provides the `ShowcaseHost` the parent got, so the pack reads the same locale and theme and its renderers call
 *   `useShowcaseHost()` like any other, and the page's `PacksHost`, so the pack knows whether it is the live one;
 * - it has an id prefix of its own (`app.config.idPrefix`): ids that Vue (`useId()`) and Reka UI generate would otherwise repeat
 *   the page app's, and two elements with one id in a document break `<label for>`;
 * - it renders the pack with the SAME Runtime (`@deviltea/widget-vue`'s root renderer), and `unmount()` removes the app and its
 *   head entries. The Runtime is never touched here: it belongs to the Preview frame, which disposes it after the Vue trees.
 *
 * `liveNuxtUiApps()` and `createdNuxtUiApps()` count the nested apps, so a test can assert that one is created per mount and that
 * none is left behind after a pack switch or an unmount.
 *
 * Styles: `./packs-ui.css` is imported here and nowhere else, so it is part of the lazy chunk of this pack only.
 */

import type { App, Ref } from 'vue'
import type { ShowcaseHost } from '../../../../showcase-host'
import type { PacksRuntime } from '../../system'
import type { PacksHost } from '../packs-host'
import UApp from '@nuxt/ui/components/App.vue'
import ui from '@nuxt/ui/vue-plugin'
import { createApp, defineComponent, h } from 'vue'
import { ShowcaseHostKey } from '../../../../showcase-host'
import { PacksHostKey } from '../packs-host'
import { NuxtUiWidgetRenderer } from './index'
import { disableRemoteIcons } from './offline-icons'
import { PORTAL_SELECTOR } from './portal'
import './packs-ui.css'

/** The prefix of every id the nested app generates (`useId()`, Reka), so none can equal one of the page's own app. */
export const ID_PREFIX = 'packs-nui'

export interface NestedNuxtUiApp {
	readonly app: App
	unmount: () => void
}

const live = new Set<App>()
let created = 0

/** How many nested Nuxt UI apps are mounted right now. */
export function liveNuxtUiApps(): number {
	return live.size
}

/** How many nested Nuxt UI apps have been created since the module loaded. */
export function createdNuxtUiApps(): number {
	return created
}

interface Head {
	readonly dispose?: () => void
}

export function mountNuxtUiApp(options: { readonly target: HTMLElement, readonly host: ShowcaseHost, readonly packs: PacksHost, readonly runtime: Readonly<Ref<PacksRuntime>> }): NestedNuxtUiApp {
	const { target, host, packs, runtime } = options
	// Icons are bundled at build time; never ask the Iconify API for anything else (see the module).
	disableRemoteIcons()
	const Root = defineComponent({
		name: 'NuxtUiPackRoot',
		// `UApp` renders no element of its own and `toaster: null` keeps its fixed toast viewport out of the DOM.
		setup: () => () => h(UApp, { portal: PORTAL_SELECTOR, toaster: null }, { default: () => h(NuxtUiWidgetRenderer, { runtime: runtime.value }) }),
	})
	const app = createApp(Root)
	// Two Vue apps in one document would both hand out `v-0`, `v-1`, ...: duplicate ids break every `<label for>` and `aria-*` reference.
	app.config.idPrefix = ID_PREFIX
	app.provide(ShowcaseHostKey, host)
	app.provide(PacksHostKey, packs)
	app.use(ui)
	app.mount(target)
	created++
	live.add(app)
	let mounted = true
	return {
		app,
		unmount: () => {
			if (!mounted)
				return
			mounted = false
			app.unmount()
			live.delete(app)
			// The plugin installs an `unhead` instance of its own; its generated colour block belongs to this app only.
			;(app._context.provides.usehead as Head | undefined)?.dispose?.()
		},
	}
}
