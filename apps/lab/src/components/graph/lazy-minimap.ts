/**
 * `@vue-flow/minimap`'s `MiniMap`, loaded the first time `GraphCanvas.vue` shows it: the package bundles its own copy of d3-zoom,
 * about 57 KB raw / 19 KB gzip on the eager main chunk when imported statically, for a panel most sessions never see. Defined once
 * here, for the module, not per canvas instance.
 */
import { defineAsyncComponent } from 'vue'

export const MiniMap = defineAsyncComponent(async () => (await import('@vue-flow/minimap')).MiniMap)
