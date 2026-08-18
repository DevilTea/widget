// @vitest-environment happy-dom
/**
 * Issue #28 accessibility fix — cheap attribute-wiring assertion only. #43 adds a presentation-only
 * locale dependency for the renderer-owned empty-choice placeholder; this harness supplies an English
 * identity translator without changing config-projected labels/options or semantic behavior.
 */
import { createWidgetVueRenderer, useWidget } from '@deviltea/widget-vue'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'
import { LabI18nKey } from '../../../composables/use-lab-i18n'
import { ConditionalSectionPlugin, SurveySectionPlugin, TripSurveyPlugin } from '../plugins'
import { defaultSurveyPreset } from '../presets'
import { surveySystem } from '../system'
import { widgetOfType } from '../test-support'
import SurveyChoiceQuestionRenderer from './SurveyChoiceQuestionRenderer.vue'

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
		.SurveyNumberQuestion(NoopRenderer)
		.SurveyChoiceQuestion(SurveyChoiceQuestionRenderer as unknown as any)
		.TripMetrics(NoopRenderer)
		.TripReadiness(NoopRenderer)
		.TripRecommendation(NoopRenderer))

describe('surveyChoiceQuestionRenderer', () => {
	it('associates its visible label with the select via for/id', async () => {
		const definition = JSON.parse(defaultSurveyPreset.sourceText)
		const blueprint = surveySystem.createBlueprint(definition)
		if (blueprint.status !== 'valid')
			throw new Error('expected a valid Blueprint')
		const runtime = blueprint.createRuntime()

		const children = widgetOfType(runtime, 'children', 'SurveyNumberQuestion')
		children.state.answer.set(1)

		const wrapper = mount(HarnessRenderer, {
			props: { runtime },
			global: {
				config: { globalProperties: { pika: (value: unknown) => JSON.stringify(value) } },
				provide: {
					[LabI18nKey as symbol]: {
						locale: { value: 'en' },
						locales: ['en', 'zh-TW'],
						setLocale: () => {},
						t: (source: string) => source,
					},
				},
			},
		})
		await wrapper.vm.$nextTick()
		await wrapper.vm.$nextTick()

		const select = wrapper.find('select')
		const label = wrapper.find('label')
		expect(select.exists())
			.toBe(true)
		expect(label.attributes('for'))
			.toBe(select.attributes('id'))
		expect(select.attributes('id'))
			.toBeTruthy()
	})
})
