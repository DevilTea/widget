#!/usr/bin/env node
/**
 * Writes Nuxt UI's generated theme templates (`node_modules/.nuxt-ui/**`, which the `#build/ui` paths in
 * `tsconfig.app.json` point at) without a full Vite build.
 *
 * `@nuxt/ui`'s Vite plugin writes those files from its `config` hook, i.e. as a side effect of any
 * `vite dev`/`vite build`/Vitest run. `vue-tsc` never runs through Vite, so `pnpm typecheck` runs this script
 * first: it resolves the Lab's own
 * `vite.config.ts` (so the options in `nuxt-ui.ts` stay the single source), which runs every plugin's
 * `config` hook, and does nothing else. The output lives under `node_modules`, so there is nothing to
 * commit or ignore, and a clean checkout type-checks deterministically.
 *
 * This is also why `autoImport`/`components`/`dts` are off in `nuxt-ui.ts`: no `auto-imports.d.ts` or
 * `components.d.ts` is ever generated, so there is no generated declaration the typecheck could depend on.
 */
import process from 'node:process'
import { resolveConfig } from 'vite'

await resolveConfig({ root: process.cwd(), configFile: 'vite.config.ts', logLevel: 'warn' }, 'build')
