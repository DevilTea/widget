// @vitest-environment happy-dom
/**
 * Issue #28 accessibility fix — cheap attribute-wiring assertions only (see `TripMetricsRenderer.unit.test.ts`
 * for this file's harness style): the visible `label`'s `for` matches the `input`'s `id`, and — because
 * `return` (`SurveyDateQuestion`) is configured with `help` text (`../presets.ts`) — the `input`'s
 * `aria-describedby` matches the help paragraph's `id`. Behavioral focus/keyboard coverage belongs to the
 * real-browser contract suite (issue #28), not here.
 */
import { createWidgetVueRenderer, useWidget } from '@deviltea/widget-vue'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'
import { ConditionalSectionPlugin, SurveySectionPlugin, TripSurveyPlugin } from '../plugins'
import { defaultSurveyPreset } from '../presets'
import { surveySystem } from '../system'
import SurveyDateQuestionRenderer from './SurveyDateQuestionRenderer.vue'

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
		.SurveyDateQuestion(SurveyDateQuestionRenderer as unknown as any)
		.SurveyNumberQuestion(NoopRenderer)
		.SurveyChoiceQuestion(NoopRenderer)
		.TripMetrics(NoopRenderer)
		.TripReadiness(NoopRenderer)
		.TripRecommendation(NoopRenderer))

describe('surveyDateQuestionRenderer', () => {
	it('associates its visible label and help text with the input via for/id and aria-describedby', async () => {
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

		const input = wrapper.find('input[type="date"]')
		const label = wrapper.find('label')
		expect(label.attributes('for'))
			.toBe(input.attributes('id'))
		expect(input.attributes('id'))
			.toBeTruthy()

		const help = wrapper.find('p')
		expect(help.exists())
			.toBe(true)
		expect(input.attributes('aria-describedby'))
			.toBe(help.attributes('id'))
	})
})
