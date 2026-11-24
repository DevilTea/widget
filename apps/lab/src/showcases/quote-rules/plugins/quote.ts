/**
 * `Quote`: the root of a price quote. It has no State of its own; the customer's answers are State on the Items and
 * the rules. Its slots are `items` (the Items) and `rules` (the pricing rules), and its Properties collect them:
 *
 * - `subtotalCents`, `totalQuantity`: what the Items add up to (the rules read these);
 * - `taxableCents`: the subtotal plus every rule that is not the tax (`SalesTax` reads this);
 * - `answers`: every answer the customer gave, by widget id and State name: the request half of a JSON-in call;
 * - `quote`: the whole priced quote as plain JSON: the response half. It is the only thing a backend needs back.
 *
 * `answers` and `quote` are what make the same rules usable outside a page: a backend (`../evaluate.ts`, run in a
 * Web Worker by the Preview) is given the document and the answers, writes the answers into a fresh Runtime and
 * reads `quote`.
 */

import type { WidgetContract, WidgetInterfaces } from '@deviltea/widget-core'
import type { QuoteConfig } from '../config'
import type { Adjustment, ItemLine, QuoteAdjustment, QuoteAnswers, QuoteLine, QuoteResult } from '../domain'
import type { QuoteRawConfig } from '../raw-config'
import type { RuleType } from './reads'
import { createWidgetPlugin } from '@deviltea/widget-core'
import { resolveQuoteConfig } from '../config'
import { quoteConfigDocs, quoteRawConfigDocs, quoteResultDocs } from '../docs'
import { isPlainObject } from '../domain'
import { quoteConfigSchema } from '../schemas'
import { guard } from '../standard-schema'
import { childIds, isNumber, PRE_TAX_RULE_TYPES, RULE_TYPES, valueOr } from './reads'

export interface QuoteInterfaces extends WidgetInterfaces {
	config: { raw: QuoteRawConfig, resolved: QuoteConfig }
	slots: {
		items: WidgetContract<{ state: { quantity: number, paper: string }, properties: { line: ItemLine } }, 'Item'>
		rules: WidgetContract<{ properties: { adjustment: Adjustment } }, RuleType>
	}
	properties: {
		subtotalCents: number
		totalQuantity: number
		taxableCents: number
		answers: QuoteAnswers
		quote: QuoteResult
	}
}

function isItemLine(input: unknown): input is ItemLine {
	return isPlainObject(input) && isNumber(input.cents) && isNumber(input.quantity)
}

function isAdjustment(input: unknown): input is Adjustment {
	return isPlainObject(input) && isNumber(input.cents) && typeof input.kind === 'string'
}

export const QuotePlugin = createWidgetPlugin('Quote')
	.description('The root of a price quote. Slots: `items` (the Items) and `rules` (VolumeDiscount, RushSurcharge, Delivery and SalesTax, each at most once). Properties: `subtotalCents`, `totalQuantity`, `taxableCents`, `answers` (every answer the customer gave, by widget id and State name) and `quote` (the whole priced quote as plain JSON).')
	.interfaces<QuoteInterfaces>()
	.config({
		description: 'The quote title and the currency. Validated by a Valibot schema through Standard Schema.',
		raw: quoteRawConfigDocs,
		resolved: quoteConfigDocs,
		validate: guard(quoteConfigSchema),
		resolve: resolveQuoteConfig,
	})
	.slots({
		items: {
			description: 'The printed products, in display order: Item widgets (at least one).',
			validateStructure: ({ children, addDiagnostic }) => {
				if (children.length === 0)
					addDiagnostic({ message: 'A quote needs at least one Item.', reason: 'needs-an-item' })
				children.forEach((child, index) => {
					if (child.resolved && child.type !== 'Item')
						addDiagnostic({ message: `"${child.type}" is not an Item.`, index, reason: 'not-an-item' })
				})
			},
		},
		rules: {
			description: 'The pricing rules, in display order: VolumeDiscount, RushSurcharge, Delivery and SalesTax, each at most once.',
			validateStructure: ({ children, addDiagnostic }) => {
				const seen = new Set<string>()
				children.forEach((child, index) => {
					if (!child.resolved)
						return
					if (!(RULE_TYPES as readonly string[]).includes(child.type))
						addDiagnostic({ message: `"${child.type}" is not a pricing rule.`, index, reason: 'not-a-rule' })
					else if (seen.has(child.type))
						addDiagnostic({ message: `The quote already has a ${child.type} rule.`, index, reason: 'duplicate-rule-type' })
					seen.add(child.type)
				})
			},
		},
	})
	.structure(({ widget, blueprint, addDiagnostic }) => {
		if (blueprint.getParent(widget) !== null)
			addDiagnostic({ message: 'A Quote must be the root widget.', reason: 'quote-not-root' })
	})
	.properties(properties => properties
		.subtotalCents({
			description: 'What the Items\' lines add up to, in minor units.',
			registerDeps: ({ dep, blueprint }) => ({
				items: Object.fromEntries(childIds(blueprint, 'items', ['Item'])
					.map(id => [id, dep.widget(id)
						.properties
						.get('line')
						.validate(isItemLine)] as const)),
			}),
			compute: ({ deps }) => Object.values(deps.items)
				.reduce((sum, read) => {
					const line = read()
					return line.ok && line.value !== null ? sum + line.value.cents : sum
				}, 0),
		})
		.totalQuantity({
			description: 'The number of pieces over every Item.',
			registerDeps: ({ dep, blueprint }) => ({
				items: Object.fromEntries(childIds(blueprint, 'items', ['Item'])
					.map(id => [id, dep.widget(id)
						.properties
						.get('line')
						.validate(isItemLine)] as const)),
			}),
			compute: ({ deps }) => Object.values(deps.items)
				.reduce((sum, read) => {
					const line = read()
					return line.ok && line.value !== null ? sum + line.value.quantity : sum
				}, 0),
		})
		.taxableCents({
			description: 'The subtotal plus every rule that is not the tax, in minor units (`SalesTax` reads it).',
			registerDeps: ({ dep, blueprint }) => ({
				subtotal: dep.self.properties.get('subtotalCents'),
				rules: Object.fromEntries(childIds(blueprint, 'rules', PRE_TAX_RULE_TYPES)
					.map(id => [id, dep.widget(id)
						.properties
						.get('adjustment')
						.validate(isAdjustment)] as const)),
			}),
			compute: ({ deps }) => Object.values(deps.rules)
				.reduce((sum, read) => {
					const adjustment = read()
					return adjustment.ok && adjustment.value !== null ? sum + adjustment.value.cents : sum
				}, valueOr(deps.subtotal, 0)),
		})
		.answers({
			description: 'Every answer the customer gave, by widget id and State name: the request half of a JSON-in call.',
			registerDeps: ({ dep, blueprint }) => ({
				items: Object.fromEntries(childIds(blueprint, 'items', ['Item'])
					.map(id => [id, {
						quantity: dep.widget(id)
							.state
							.get('quantity'),
						paper: dep.widget(id)
							.state
							.get('paper'),
					}] as const)),
				rush: Object.fromEntries(childIds(blueprint, 'rules', ['RushSurcharge'])
					.map(id => [id, { enabled: dep.widget(id)
						.state
						.get('enabled') }] as const)),
				delivery: Object.fromEntries(childIds(blueprint, 'rules', ['Delivery'])
					.map(id => [id, { method: dep.widget(id)
						.state
						.get('method') }] as const)),
			}),
			compute: ({ deps }): QuoteAnswers => {
				const answers: Record<string, Record<string, unknown>> = {}
				for (const group of [deps.items, deps.rush, deps.delivery]) {
					for (const [id, reads] of Object.entries(group)) {
						answers[id] = Object.fromEntries(Object.entries(reads)
							.map(([name, read]) => {
								const result = (read as () => { ok: boolean, value?: unknown })()
								return [name, result.ok ? result.value : null] as const
							}))
					}
				}
				return answers
			},
		})
		.quote({
			description: 'The whole priced quote as plain JSON: the response half.',
			ref: quoteResultDocs,
			registerDeps: ({ dep, blueprint }) => ({
				subtotal: dep.self.properties.get('subtotalCents'),
				taxable: dep.self.properties.get('taxableCents'),
				items: Object.fromEntries(childIds(blueprint, 'items', ['Item'])
					.map(id => [id, dep.widget(id)
						.properties
						.get('line')
						.validate(isItemLine)] as const)),
				rules: Object.fromEntries(childIds(blueprint, 'rules', RULE_TYPES)
					.map(id => [id, dep.widget(id)
						.properties
						.get('adjustment')
						.validate(isAdjustment)] as const)),
			}),
			compute: ({ deps, config }): QuoteResult => {
				const lines: QuoteLine[] = []
				for (const [id, read] of Object.entries(deps.items)) {
					const line = read()
					if (line.ok && line.value !== null)
						lines.push({ id, ...line.value })
				}
				const adjustments: QuoteAdjustment[] = []
				for (const [id, read] of Object.entries(deps.rules)) {
					const adjustment = read()
					if (adjustment.ok && adjustment.value !== null)
						adjustments.push({ id, ...adjustment.value })
				}
				const taxable = valueOr(deps.taxable, 0)
				const tax = adjustments.filter(adjustment => adjustment.kind === 'tax')
					.reduce((sum, adjustment) => sum + adjustment.cents, 0)
				return { currency: config.currency, lines, adjustments, subtotalCents: valueOr(deps.subtotal, 0), taxableCents: taxable, totalCents: taxable + tax }
			},
		}))
	.done()
