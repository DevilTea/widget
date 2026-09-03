/** Build one GitHub Pages artifact containing the VitePress docs and Widget Lab. */
import { cp, rm } from 'node:fs/promises'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { join } from 'pathe'
import { $ } from 'zx'

const LAB_BASE = '/widget/lab/'
const root = fileURLToPath(new URL('..', import.meta.url))
const labDist = join(root, 'apps/lab/dist')
const docsDist = join(root, 'docs/site/.vitepress/dist')
const labTarget = join(docsDist, 'lab')

$.cwd = root
$.verbose = true

await $({ env: { ...process.env, WIDGET_LAB_BASE: LAB_BASE } })`pnpm --filter widget-lab... run build`
await $`pnpm --filter docs run build`
await rm(labTarget, { recursive: true, force: true })
await cp(labDist, labTarget, { recursive: true })

console.log(`Combined Pages artifact ready at ${docsDist} (Widget Lab under lab/, base ${LAB_BASE})`)
