import { createApp } from 'vue'
import App from './App.vue'
// PikaCSS's build-time-generated CSS (see `pika.config.ts`; resolved by `@pikacss/unplugin-pikacss`).
import 'pika.css'
import './styles/global.css'

createApp(App)
	.mount('#app')
