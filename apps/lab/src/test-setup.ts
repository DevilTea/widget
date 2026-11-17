/**
 * Vitest `setupFiles` entry for every run that includes the Lab's unit tests (this app's `vitest.config.ts`
 * and the repository root `vitest.config.ts`). It makes the "icons are offline" guarantee global: a test
 * that mounts a Nuxt UI icon, with or without `test-support-ui.ts`, can never reach `api.iconify.design`.
 *
 * `offline-icons.unit.test.ts` re-imports the modules after stubbing `fetch`, so it still tests the switch
 * itself rather than this file.
 */
import { disableRemoteIcons } from './ui/offline-icons'

disableRemoteIcons()
