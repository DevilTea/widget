/**
 * Mount globals for Lab unit tests that render a Nuxt UI component. Importing Nuxt UI's Vue plugin evaluates its
 * runtime (icons, head, ...), which tests that mount only plain components should not pay for or be exposed to.
 *
 * Icons stay offline for every Lab unit test through `test-setup.ts` (Vitest `setupFiles`).
 *
 * Usage:
 *
 *   mount(Component, { global: { plugins: testGlobalPlugins } })
 *
 * It is the real plugin, not stubs: `labNuxtUi()` (`nuxt-ui.ts`) is part of every Vitest config (this app's
 * and the repository root's), so `#imports`/`#build/*` resolve and a mounted `UButton` renders its real
 * markup and classes (`data-slot`, icon, aria). Components that open overlays, tooltips or toasts also need
 * `UApp` (`@nuxt/ui/components/App.vue`) as an ancestor, exactly as `main.ts` provides it.
 */
import ui from '@nuxt/ui/vue-plugin'

export const testGlobalPlugins = [ui]
