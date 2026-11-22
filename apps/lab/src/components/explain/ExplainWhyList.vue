<script setup lang="ts">
/**
 * "Why it behaves this way": the Explain tab's dependency sentences (`explain/why.ts`) as a list, one item per Property of
 * the selected widget and other widget it reads or calls. With `live` set, every State or Property read shows its current
 * Preview value; without it (no valid Preview, or one that shows another revision) the sentences show none, so the values
 * never come from another version of the document. A config field that names the other widget follows with its generated
 * description. The other widget is a button that selects it.
 *
 * The sentence is a translated template whose placeholders become elements (`templateParts`); every inline piece is an
 * element with `v-text`, so the template's own line breaks never put spaces inside a sentence.
 */
import type { InspectionNodeId } from '@deviltea/widget-core/inspection'
import type { InspectorClient } from '@deviltea/widget-inspector/client'
import type { WhyMember, WhySentence } from '../../explain/why'
import { useLabI18n } from '../../composables/use-lab-i18n'
import { templateParts } from '../../lib/prose'
import DocProse from './DocProse.vue'
import ExplainLiveValue from './ExplainLiveValue.vue'

export interface ExplainLiveSource {
	readonly client: InspectorClient
	readonly runtimeId: string
	/** The Preview node of the widget with this id and type (linked revisions only), `null` when the Preview has none. */
	readonly previewNodeIdOf: (widgetId: string, widgetType: string) => number | null
}

const props = defineProps<{
	sentences: readonly WhySentence[]
	live: ExplainLiveSource | null
}>()

const emit = defineEmits<{ select: [nodeId: InspectionNodeId] }>()
const i18n = useLabI18n()

function sentenceTemplate(sentence: WhySentence): string {
	return sentence.operation === 'reads'
		? i18n.t('{property} reads {widget}\'s {members}')
		: i18n.t('{property} calls {widget}\'s {members}')
}

function separator(): string {
	return i18n.locale.value === 'zh-TW' ? '、' : ', '
}

/** The Preview widget to read `member` from, or `null` when no live value is shown for it (a Method has none). */
function liveNodeOf(sentence: WhySentence, member: WhyMember): number | null {
	if (props.live === null || member.type === 'method')
		return null
	return props.live.previewNodeIdOf(sentence.target.widgetId, sentence.target.widgetType)
}

function valueMember(member: WhyMember): { type: 'state' | 'property', name: string } {
	return { type: member.type === 'state' ? 'state' : 'property', name: member.name }
}
</script>

<template>
	<ul
		role="list"
		class="m-0 flex list-none flex-col gap-1.5 p-0 text-xs leading-5"
		data-testid="explain-why-list"
	>
		<li
			v-for="sentence in sentences"
			:key="sentence.key"
			data-testid="explain-why"
			:data-property="sentence.property"
			:data-target="sentence.target.widgetId"
			class="rounded-(--lab-radius) border border-default px-2 py-1.5"
		>
			<span data-testid="explain-why-sentence">
				<template
					v-for="(part, index) in templateParts(sentenceTemplate(sentence))"
					:key="index"
				>
					<span
						v-if="'text' in part"
						v-text="part.text"
					/>
					<code
						v-else-if="part.param === 'property'"
						class="font-lab-mono font-semibold"
						v-text="sentence.property"
					/>
					<button
						v-else-if="part.param === 'widget'"
						type="button"
						data-testid="explain-why-target"
						class="inline min-h-6 cursor-pointer rounded-(--lab-radius) border-0 bg-transparent p-0 font-lab-mono text-xs text-primary underline decoration-dotted underline-offset-2 hover:decoration-solid focus-visible:outline-2 focus-visible:outline-primary"
						:aria-label="i18n.t('Select widget {id}', { id: `#${sentence.target.widgetId}` })"
						@click="emit('select', sentence.target.nodeId)"
						v-text="`#${sentence.target.widgetId}`"
					/>
					<template v-else>
						<template
							v-for="(member, memberIndex) in sentence.members"
							:key="`${member.type}:${member.name}`"
						>
							<span
								v-if="memberIndex > 0"
								v-text="separator()"
							/>
							<template v-if="liveNodeOf(sentence, member) !== null">
								<template
									v-for="(memberPart, memberPartIndex) in templateParts(i18n.t('{member} (now: {value})'))"
									:key="memberPartIndex"
								>
									<span
										v-if="'text' in memberPart"
										v-text="memberPart.text"
									/>
									<code
										v-else-if="memberPart.param === 'member'"
										class="font-lab-mono"
										v-text="member.name"
									/>
									<ExplainLiveValue
										v-else
										:client="live!.client"
										:widgetRef="{ runtimeId: live!.runtimeId, nodeId: liveNodeOf(sentence, member)! }"
										:member="valueMember(member)"
									/>
								</template>
							</template>
							<code
								v-else
								class="font-lab-mono"
								v-text="member.name"
							/>
						</template>
					</template>
				</template>
			</span>
			<span
				v-for="field in sentence.fields"
				:key="field.name"
				data-testid="explain-why-field"
				:data-field="field.name"
				class="block text-muted"
			>
				<span v-text="'— '" />
				<code
					class="font-lab-mono"
					v-text="field.name"
				/>
				<template v-if="field.description !== ''">
					<span v-text="': '" />
					<DocProse :text="field.description" />
				</template>
				<span
					v-else
					v-text="` ${i18n.t('(a config field that names this widget)')}`"
				/>
			</span>
		</li>
	</ul>
</template>
