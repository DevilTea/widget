// @vitest-environment happy-dom
/**
 * Diagnostic #28 accessibility fix — cheap attribute-wiring assertions only (see `TripMetricsRenderer.unit.test.ts`
 * for this file's harness style): every `SurveyNumberQuestion`'s visible `label` has its `for` matched to
 * its `input`'s `id`. `../presets.ts` configures three instances — `adults`/`children` *without* `help`
 * text and `budget` *with* it — so this also covers both `aria-describedby` cases: absent when there is
 * no help paragraph, present and matching the help paragraph's `id` when there is one. Behavioral
 * focus/keyboard coverage belongs to the real-browser contract suite (diagnostic #28), not here.
 */
import { createWidgetVueRenderer, useWidget } from '@deviltea/widget-vue'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'
import { ConditionalSectionPlugin, SurveySectionPlugin, TripSurveyPlugin } from '../plugins'
import { defaultSurveyPreset } from '../presets'
import { surveySystem } from '../system'
import SurveyNumberQuestionRenderer from './SurveyNumberQuestionRenderer.vue'

const NoopRenderer = defineComponent({ setup: () => () => null })

function makeSlotRenderer(plugin: any, slotName: string) {
	return defineComponent({
		setup() {
			const { WidgetSlot } = useWidget(plugin)
			return () => h(WidgetSlot, { name: slotName })
		},
	})
}

const HarnessRenderer = createWidgetVueRenderer(surveySystem, renderers =>
	renderers
		.TripSurvey(makeSlotRenderer(TripSurveyPlugin, 'form'))
		.SurveySection(makeSlotRenderer(SurveySectionPlugin, 'body'))
		.ConditionalSection(defineComponent({
			setup() {
				const { useProperties, WidgetSlot } = useWidget(ConditionalSectionPlugin)
				const { visible } = useProperties()
				return () => visible.value === true ? h(WidgetSlot, { name: 'body' }) : null
			},
		}))
		.SurveyDateQuestion(NoopRenderer)
		.SurveyNumberQuestion(SurveyNumberQuestionRenderer as unknown as any)
		.SurveyChoiceQuestion(NoopRenderer)
		.TripMetrics(NoopRenderer)
		.TripReadiness(NoopRenderer)
		.TripRecommendation(NoopRenderer))

describe('surveyNumberQuestionRenderer', () => {
	it('associates each visible label with its input via for/id, and help text via aria-describedby only when configured', async () => {
		const definition = JSON.parse(defaultSurveyPreset.sourceText)
		const blueprint = surveySystem.createBlueprint(definition)
		if (blueprint.status !== 'valid')
			throw new Error('expected a valid Blueprint')
		const runtime = blueprint.createRuntime()

		const wrapper = mount(HarnessRenderer, {
			props: { runtime },
			global: { config: { globalProperties: { pika: (value: unknown) => JSON.stringify(value) } } },
		})
		await wrapper.vm.$nextTick()

		const labels = wrapper.findAll('label')
		// `adults`/`children`/`budget` (`../presets.ts`) — every `SurveyNumberQuestion` in this preset.
		expect(labels.length)
			.toBe(3)

		let sawConfiguredHelp = false
		for (const label of labels) {
			const container = label.element.parentElement
			if (container === null)
				throw new Error('expected the label to have a parent container')
			const input = container.querySelector<HTMLInputElement>('input[type="number"]')
			if (input === null)
				throw new Error('expected a sibling number input')
			expect(input.id)
				.toBeTruthy()
			expect(label.attributes('for'))
				.toBe(input.id)

			const help = container.querySelector('p')
			if (label.text()
				.toLowerCase()
				.includes('budget')) {
				// `budget` is configured with `help` text — the one positive case.
				sawConfiguredHelp = true
				expect(help)
					.not.toBeNull()
				expect(input.getAttribute('aria-describedby'))
					.toBe(help!.id)
			}
			else {
				// `adults`/`children` are configured without `help` text — no paragraph to describe, so no
				// `aria-describedby` should be added.
				expect(help)
					.toBeNull()
				expect(input.hasAttribute('aria-describedby'))
					.toBe(false)
			}
		}
		expect(sawConfiguredHelp)
			.toBe(true)
	})
})
