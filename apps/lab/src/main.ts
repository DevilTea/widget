import { createApp } from 'vue'
import { createVuetify } from 'vuetify'
import App from './App.vue'
// PikaCSS's build-time-generated CSS (see `pika.config.ts`; resolved by `@pikacss/unplugin-pikacss`).
import 'pika.css'
import './styles/global.css'

const vuetify = createVuetify({
	theme: { defaultTheme: 'system' },
})

createApp(App)
	.use(vuetify)
	.mount('#app')
