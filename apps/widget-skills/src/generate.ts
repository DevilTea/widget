/**
 * Everything the generator writes for one System, as a map from relative path to file content.
 */

import type { SystemIr } from './ir'
import type { SkillOptions } from './skills'
import { emitFullSchema, emitLlmSchema } from './schema'
import { emitSkills } from './skills'

/** Lists the generated files of the previous run, so the next run can remove the ones it no longer writes. */
export const MANIFEST_FILE = '.generated.json'

function json(value: unknown): string {
	return `${JSON.stringify(value, null, '\t')}\n`
}

export function generateFiles(ir: SystemIr, options: SkillOptions = {}): Record<string, string> {
	const fullSchema = json(emitFullSchema(ir))
	const llmSchema = json(emitLlmSchema(ir))
	const files: Record<string, string> = {
		'ir.json': json(ir),
		'schema/document.schema.json': fullSchema,
		'schema/document.llm.schema.json': llmSchema,
		...emitSkills(ir, { fullSchema, llmSchema }, options),
	}
	files[MANIFEST_FILE] = json({ files: Object.keys(files)
		.sort() })
	return files
}
