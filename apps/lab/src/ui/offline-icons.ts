import { _api } from '@iconify/vue'

/**
 * Icons are offline by construction. Every `i-lucide-*` name used in `src` is inlined at build time from the
 * locally installed `@iconify-json/lucide` collection (`nuxt-ui.ts`, `icon.clientBundle.scan`), and Nuxt UI's
 * own icons are bundled with it. Iconify's runtime would still ask its public API for a name that is not
 * bundled (a typo, a dynamically built name, a collection that is not installed), and the Lab's e2e suite
 * aborts every off-origin request, so such a gap would only show as a silently empty icon.
 *
 * Iconify only talks to the network through the `fetch` it holds; with none, a query is aborted immediately
 * ("icon not found") and nothing is ever requested, in the app, in unit tests and on the Pages build.
 * Install the collection or list the name in `icon.clientBundle.icons` instead.
 *
 * (`addAPIProvider('', { resources: [] })` looks like the obvious switch but is ignored: a provider
 * without resources is rejected and the public default stays active.)
 */
export function disableRemoteIcons(): void {
	_api.setFetch(undefined as never)
}
