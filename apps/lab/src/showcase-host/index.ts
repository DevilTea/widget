/**
 * The showcase host contract: the only module outside its own directory a showcase may import.
 * See `host.ts` and `apps/lab/AGENTS.md` ("Showcase isolation").
 */

export type { ConfigJsonSchema, ConfigSchemaMap } from './config-schemas'
export { CONFIG_JSON_SCHEMA_DIALECT } from './config-schemas'
export type { ShowcaseHost, ShowcaseLocale, ShowcaseTheme } from './host'
export { SHOWCASE_LOCALES, SHOWCASE_THEMES, ShowcaseHostKey, useShowcaseHost } from './host'
export { useInspectAnchor } from './inspect-anchor'
export type { ShowcaseMessages } from './messages'
export { defineShowcaseMessages, translateShowcaseMessage, useShowcaseMessages } from './messages'
export type { CuratedSourceFile, CuratedSourceFileKind, CuratedWidgetTypeSources, SourcesRegistry } from './sources'
