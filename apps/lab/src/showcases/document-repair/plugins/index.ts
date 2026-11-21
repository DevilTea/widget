/**
 * The two repair desk plugins as one tuple for `createWidgetSystem` (see `../system.ts`). `RepairDesk` is first: the
 * Implementation catalog marks the first type as the current one. The notice board plugins (the inner system) are in
 * `../board/plugins.ts`.
 */

import { RepairDeskPlugin } from './repair-desk'
import { SavedDraftPlugin } from './saved-draft'

export * from './repair-desk'
export * from './saved-draft'

export const repairPlugins = [RepairDeskPlugin, SavedDraftPlugin] as const

export type RepairPlugins = typeof repairPlugins
