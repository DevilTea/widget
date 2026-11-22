/**
 * `emitDocs(ir)`: the JSON documentation object the Vite plugin serves as `virtual:widget-docs/<name>`, and `slimDocs(docs)`, its
 * slim projection (`widgetDocs({ slim: true })`).
 */

import type { WidgetDocs, WidgetDocsJsonSchema, WidgetDocsNamedType, WidgetDocsSlim, WidgetDocsSlimText, WidgetDocsText, WidgetPluginDocs, WidgetPluginDocsSlim } from './docs-types'
import type { Doc, NamedType, PluginIr, SystemIr } from './ir'
import { WIDGET_DOCS_VERSION } from './docs-types'
import { emitConfigSchema } from './schema'

function text(doc: Doc): WidgetDocsText {
	return {
		summary: doc.summary,
		remarks: doc.remarks,
		tags: { ...doc.tags },
		example: [...(doc.example ?? [])],
		deprecated: doc.deprecated ?? null,
		see: [...(doc.see ?? [])],
		defaultValue: doc.defaultValue ?? null,
	}
}

function namedType(type: NamedType): WidgetDocsNamedType {
	return {
		...text(type.doc),
		declaration: type.text,
		fields: type.shape.kind === 'object'
			? Object.fromEntries(type.shape.properties.map(property => [property.name, { ...text(property.doc), optional: property.optional }]))
			: null,
	}
}

function section<T extends { name: string }, R>(present: boolean, members: readonly T[], map: (member: T) => R): Record<string, R> | null {
	return present ? Object.fromEntries(members.map(member => [member.name, map(member)])) : null
}

function pluginDocs(ir: SystemIr, plugin: PluginIr): WidgetPluginDocs {
	const schema = emitConfigSchema(ir, plugin)
	return {
		type: plugin.type,
		typeNames: [...plugin.typeNames],
		interfacesName: plugin.interfacesName,
		...text(plugin.doc),
		config: plugin.config === null
			? null
			: {
					...text(plugin.config.doc),
					omittable: plugin.config.omittable,
					rawType: plugin.config.rawText,
					resolvedType: plugin.config.resolvedText,
					schema: schema as WidgetDocsJsonSchema,
				},
		slots: section(plugin.capabilities.slots, plugin.slots, slot => ({ ...text(slot.doc), expectedTypes: slot.expected, contract: slot.contract, expectation: slot.expectationText })),
		state: section(plugin.capabilities.state, plugin.state, member => ({ ...text(member.doc), type: member.typeText, authorWritable: member.authorWritable })),
		properties: section(plugin.capabilities.properties, plugin.properties, member => ({ ...text(member.doc), type: member.typeText })),
		methods: section(plugin.capabilities.methods, plugin.methods, method => ({
			...text(method.doc),
			signature: method.signature,
			params: method.params.map(param => ({ name: param.name, type: param.typeText, optional: param.optional, summary: param.doc })),
			returns: { type: method.returnText, summary: method.returnsDoc },
		})),
		events: section(plugin.capabilities.events, plugin.events, event => ({ ...text(event.doc), payload: event.payload.map(item => ({ label: item.label, type: item.typeText })) })),
		reasons: plugin.reasons === null ? null : section(true, plugin.reasons, reason => ({ ...text(reason.doc), details: reason.payload?.typeText ?? null })),
	}
}

function slimText(text: WidgetDocsText): WidgetDocsSlimText {
	return { summary: text.summary, remarks: text.remarks }
}

function slimSection(section: Readonly<Record<string, WidgetDocsText>> | null): Record<string, WidgetDocsSlimText> | null {
	return section === null
		? null
		: Object.fromEntries(Object.entries(section)
				.map(([name, text]) => [name, slimText(text)]))
}

/** The slim projection of a docs object (`widgetDocs({ slim: true })`, see `WidgetDocsSlim`). */
export function slimDocs(docs: WidgetDocs): WidgetDocsSlim {
	return {
		docsVersion: docs.docsVersion,
		system: docs.system,
		plugins: Object.fromEntries(Object.entries(docs.plugins)
			.map(([type, plugin]): [string, WidgetPluginDocsSlim] => [type, {
				...slimText(plugin),
				config: plugin.config === null ? null : { ...slimText(plugin.config), schema: plugin.config.schema },
				slots: slimSection(plugin.slots),
				events: slimSection(plugin.events),
			}])),
	}
}

export function emitDocs(ir: SystemIr): WidgetDocs {
	return {
		docsVersion: WIDGET_DOCS_VERSION,
		system: ir.system,
		plugins: Object.fromEntries(ir.plugins.map(plugin => [plugin.type, pluginDocs(ir, plugin)])),
		types: Object.fromEntries(Object.values(ir.types)
			.map(type => [type.name, namedType(type)])),
	}
}
