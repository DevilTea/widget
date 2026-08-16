/**
 * Curated Implementation-explorer registry shape (issue #25 P3 Scope A "curated registry").
 *
 * Framework-agnostic, metadata-only (no Vue import) — mirrors `src/tutorial/types.ts`'s split from its
 * own Vue bridge. `CuratedSourceFile.load()` is the one deliberate lazy boundary the gate review's
 * "loading boundaries" amendment locked ("raw `?raw` payloads sit behind explorer-only dynamic
 * loaders, so neither the registry nor the tutorial pulls source text or Shiki into the shell's
 * initial chunks"): it is a function returning a dynamic `import('...?raw')`, never an
 * already-resolved string, so a showcase's `sources.ts` module (this type's concrete instances) can be
 * imported eagerly — it is trivially small, plugin-type -> file-descriptor metadata only — without
 * pulling any raw source *text* into the eager/shared chunk graph. Only actually *calling* `load()`
 * (from `src/components/implementation/ImplementationFile.vue`, reachable only once the Implementation
 * panel itself has been mounted — see `Workbench.vue`'s `defineAsyncComponent` registration) triggers
 * the fetch, and each distinct `import('...?raw')` specifier is Vite's own per-file async-chunk
 * boundary — one small chunk per curated file, never one bundle of every curated file's text.
 */

export type CuratedSourceFileKind = 'plugin' | 'renderer' | 'domain'

export interface CuratedSourceFile {
	readonly kind: CuratedSourceFileKind
	/** Short display title for this file's tab, e.g. "read-models.ts". */
	readonly title: string
	/** Repo-relative display path, e.g. "apps/widget-lab/src/showcases/crm/plugins/read-models.ts". */
	readonly path: string
	/** Lazy boundary (see file header) — resolves this file's raw text. */
	readonly load: () => Promise<string>
}

export interface CuratedWidgetTypeSources {
	/** The curated files for this widget type, in declaration/tab order. At least one file. */
	readonly files: readonly [CuratedSourceFile, ...CuratedSourceFile[]]
}

/** Keyed by widget/plugin type name (`WidgetPlugin.type`, e.g. `"Table"`). */
export type SourcesRegistry = Readonly<Record<string, CuratedWidgetTypeSources>>
