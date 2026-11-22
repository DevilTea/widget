/**
 * Config JSON Schemas a showcase hands to the Lab. Core 0.3 no longer carries a config schema (`config.schema` is gone), so a
 * host that renders config controls keeps its own map from plugin `type` to schema (`docs/site/migration/0.3.md`,
 * "`config.schema` is removed"). The Lab's Structure editor reads it (`lab/config-schema.ts`) and the Author Catalog shows and
 * copies it. It is presentation only: Core never validates against it.
 */

/** The JSON Schema dialect of every config schema: Draft 2020-12. */
export const CONFIG_JSON_SCHEMA_DIALECT = 'https://json-schema.org/draft/2020-12/schema' as const

/** A config JSON Schema document (the object form). */
export interface ConfigJsonSchema { readonly [keyword: string]: unknown }

/** Plugin `type` to the config JSON Schema of that plugin; a plugin without an entry has none. */
export type ConfigSchemaMap = Readonly<Record<string, ConfigJsonSchema>>
