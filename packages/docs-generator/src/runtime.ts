/**
 * `@deviltea/widget-docs-generator/runtime`: what an application bundles to read a model's output. It converts between
 * the flat node list of the LLM schema and the document tree, given the IR (`ir.json`) the generator wrote. Nothing here
 * imports TypeScript, tsx or any other build-time module.
 */

export type { FlatConverter, FlatDocument, FlatNode } from './flat'
export { createFlatConverter, FlatConversionError } from './flat'
export type { SystemIr } from './ir'
