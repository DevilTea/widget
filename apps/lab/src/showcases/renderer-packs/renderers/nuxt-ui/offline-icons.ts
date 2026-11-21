import { _api } from '@iconify/vue'

/**
 * Icons are offline by construction in the Nuxt UI pack, as they are in the Lab chrome (this is that module's approach, copied
 * here because a showcase may not import the chrome's `ui/offline-icons.ts`). Every `i-lucide-*` name used in `src` is inlined at
 * build time from the locally installed `@iconify-json/lucide` collection (`nuxt-ui.ts`, `icon.clientBundle.scan`, which also
 * scans this showcase), and Nuxt UI's own icons are bundled with it. Iconify's runtime would still ask its public API for a name
 * that is not bundled; the Preview frame is allowed no off-origin request, so such a gap would only show as a silently empty icon.
 *
 * Iconify only talks to the network through the `fetch` it holds; with none, a query is aborted immediately ("icon not found")
 * and nothing is ever requested. Install the collection or list the name in `icon.clientBundle.icons` instead.
 */
export function disableRemoteIcons(): void {
	_api.setFetch(undefined as never)
}
