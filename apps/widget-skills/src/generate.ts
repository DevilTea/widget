/**
 * Everything the generator writes for one System, as a map from relative path to file content.
 */

import type { SystemIr } from './ir'
import { emitFullSchema, emitLlmSchema } from './schema'
import { emitSkills } from './skills'

function json(value: unknown): string {
	return `${JSON.stringify(value, null, '\t')}\n`
}

export function generateFiles(ir: SystemIr): Record<string, string> {
	const fullSchema = json(emitFullSchema(ir))
	const llmSchema = json(emitLlmSchema(ir))
	return {
		'ir.json': json(ir),
		'schema/document.schema.json': fullSchema,
		'schema/document.llm.schema.json': llmSchema,
		...emitSkills(ir, { fullSchema, llmSchema }),
	}
}
