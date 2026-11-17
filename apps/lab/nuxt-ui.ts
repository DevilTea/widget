import { fileURLToPath } from 'node:url'
import ui from '@nuxt/ui/vite'

/**
 * The one place the Lab configures Nuxt UI's Vite plugin. `vite.config.ts`, `vitest.config.ts` and the
 * repository's root `vitest.config.ts` (which also runs this app's unit tests) all call it, so a mounted
 * Nuxt UI component resolves `#imports`/`#build/*` the same way in dev, build and tests. See `AGENTS.md`
 * "Nuxt UI and Tailwind" for the reasoning behind each option.
 */
export function labNuxtUi() {
	return ui({
		// Templates (`node_modules/.nuxt-ui`) always land in this app, whichever Vite root loads the plugin.
		root: fileURLToPath(new URL('.', import.meta.url)),
		// The Lab theme store (`use-lab-theme.ts`) is the single source of truth for light/dark and drives
		// the `.dark` class itself (`src/composables/use-nuxt-ui-theme-bridge.ts`). Nuxt UI's own `useDark()` plugin, with its
		// `vueuse-color-scheme` localStorage entry, would be a second authority, so it is not installed.
		colorMode: false,
		// No generated `auto-imports.d.ts`/`components.d.ts`: components and composables are imported
		// explicitly (`@nuxt/ui/components/*.vue`, `@nuxt/ui/composables`), which keeps `pnpm typecheck`
		// deterministic on a clean checkout and leaves no generated declaration to commit or ignore.
		autoImport: false,
		components: false,
		dts: false,
		// The Lab is a single workbench with no router: links render as plain anchors, `vue-router` is not needed.
		router: false,
		ui: {
			tooltip: {
				slots: {
					// No exit animation for tooltips. Reka keeps a closed tooltip's content mounted until its exit
					// animation has ended, and a mounted content still hears the "a tooltip opened" event of the NEXT
					// tooltip, including its own trigger's next open, and closes that tooltip again. With the exit
					// animation delayed (a throttled or busy page: closed tooltips were seen still mounted seconds
					// later) a keyboard user tabbing onto a header button sometimes got no tooltip, and the disabled
					// buttons explain themselves only in it. Without the animation a closed tooltip unmounts at once.
					content: 'data-[state=closed]:animate-none',
				},
			},
		},
		icon: {
			// Icons are inlined at build time from the locally installed `@iconify-json/lucide` collection
			// (`scan` finds literal `i-lucide-*` names in `src`); nothing is fetched from the Iconify API,
			// so the offline e2e fixture and the Pages build keep working.
			clientBundle: {
				scan: {
					globInclude: ['src/**/*.{vue,ts}'],
					globExclude: ['src/**/*.unit.test.ts', 'src/pika.gen.ts'],
				},
			},
		},
	})
}
