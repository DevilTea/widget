import UApp from '@nuxt/ui/components/App.vue'
import ui from '@nuxt/ui/vue-plugin'
import { createApp, defineComponent, h } from 'vue'
import App from './App.vue'
import { disableRemoteIcons } from './ui/offline-icons'
// Lab shell only: Tailwind v4 + Nuxt UI; the Preview frame entry never imports it. Import order between the
// stylesheets does not matter: the cascade layer order is fixed by the inline `<style>` in `index.html`.
import './styles/lab-ui.css'
// PikaCSS's build-time-generated CSS (see `pika.config.ts`; resolved by `@pikacss/unplugin-pikacss`).
import 'pika.css'
import './styles/global.css'

// `UApp` is Nuxt UI's global provider (tooltips, programmatic overlays, locale; toasts once a surface needs
// them: `toaster: null` keeps its empty fixed toast viewport out of the DOM until then). It renders no
// element of its own, so wrapping `App` here leaves the Lab's DOM and layout untouched.
const Root = defineComponent({
	name: 'LabRoot',
	setup: () => () => h(UApp, { toaster: null }, { default: () => h(App) }),
})

// Icons are bundled at build time; never ask the Iconify API for anything else (see the module).
disableRemoteIcons()

createApp(Root)
	.use(ui)
	.mount('#app')
