<script setup lang="ts">
/**
 * The showcase root: the intro, the pack chooser and the pane(s) of the chosen renderer pack(s). It is the PAGE's host-level
 * UI, not a widget: the chooser changes `PacksHost` (`./packs-host.ts`), which is not widget State, and switching mounts the
 * other pack's renderers over the SAME Runtime, which this component never touches.
 *
 * The hand-written pack is part of this chunk. The Nuxt UI pack (its own nested Vue app, Nuxt UI, Tailwind and stylesheet) is a
 * lazy chunk, loaded the first time a pane needs it.
 *
 * The frame paints itself from its own `--packs-*` custom properties, chosen by the host's light/dark theme
 * (`useShowcaseHost()` of the showcase host contract); the hand-written pack and the Nuxt UI pack each paint theirs, chosen by
 * the Appearance's mode.
 */
import type { packsMessages } from '../messages'
import type { PacksRuntime } from '../system'
import { computed, defineAsyncComponent, useId } from 'vue'
import { useShowcaseHost } from '../../../showcase-host'
import { HandWrittenRenderer } from './handwritten'
import { FailedPane, LoadingPane } from './pack-panes'
import { isPackChoice, PACK_CHOICES } from './packs-host'
import { requirePacksHost, usePacksText } from './use-packs-text'

defineProps<{ runtime: PacksRuntime }>()

const host = useShowcaseHost()
const packs = requirePacksHost()
const { t } = usePacksText()
const nameId = useId()
const headingId = useId()
const handHeadingId = useId()
const nuiHeadingId = useId()

const CHOICE_KEYS = { hand: 'packHand', nui: 'packNui', both: 'packBoth' } as const satisfies Record<string, keyof typeof packsMessages['en']>

const showHand = computed(() => packs.visible.value.includes('hand'))
const showNui = computed(() => packs.visible.value.includes('nui'))

const NuxtUiPack = defineAsyncComponent({
	loader: async () => (await import('./nuxt-ui/NuxtUiPack')).NuxtUiPack,
	loadingComponent: LoadingPane,
	errorComponent: FailedPane,
	delay: 0,
})

function choose(event: Event): void {
	const value = (event.target as HTMLInputElement).value
	if (isPackChoice(value))
		packs.setChoice(value)
}
</script>

<template>
	<main
		class="packs"
		data-testid="packs-root"
		:data-packs-frame-theme="host.theme.value"
		:aria-labelledby="headingId"
	>
		<header class="packs-header">
			<h1
				:id="headingId"
				class="packs-title"
			>
				{{ t('title') }}
			</h1>
			<p class="packs-intro">
				{{ t('intro') }}
			</p>
		</header>

		<fieldset
			class="packs-chooser"
			data-tutorial-target="packs-chooser"
			data-testid="packs-chooser"
		>
			<legend class="packs-chooser-legend">
				{{ t('packsLabel') }}
			</legend>
			<label
				v-for="choice in PACK_CHOICES"
				:key="choice"
				class="packs-chooser-option"
			>
				<input
					type="radio"
					:name="nameId"
					:value="choice"
					:checked="packs.choice.value === choice"
					:data-testid="`packs-choice-${choice}`"
					@change="choose"
				>
				<span>{{ t(CHOICE_KEYS[choice]) }}</span>
			</label>
		</fieldset>
		<p class="packs-note">
			{{ t('paneNote') }}
		</p>

		<div
			class="packs-panes"
			:data-layout="packs.choice.value"
			data-testid="packs-panes"
		>
			<section
				v-if="showHand"
				class="packs-pane"
				:aria-labelledby="handHeadingId"
				data-testid="packs-pane-hand"
			>
				<h2
					:id="handHeadingId"
					class="packs-pane-title"
				>
					{{ t('paneHand') }}
				</h2>
				<HandWrittenRenderer :runtime="runtime" />
			</section>
			<section
				v-if="showNui"
				class="packs-pane"
				:aria-labelledby="nuiHeadingId"
				data-testid="packs-pane-nui"
			>
				<h2
					:id="nuiHeadingId"
					class="packs-pane-title"
				>
					{{ t('paneNui') }}
				</h2>
				<NuxtUiPack :runtime="runtime" />
			</section>
		</div>
	</main>
</template>

<style scoped>
/* Dark is the default, like the frame; light is chosen by `data-packs-frame-theme`. Each pack re-declares these on its own root. */
.packs {
	--packs-bg: #14161a;
	--packs-surface: #1b1e24;
	--packs-border: #2c313a;
	--packs-control-border: #8a93a1;
	--packs-text: #e6e8eb;
	--packs-text-muted: #9aa2af;
	--packs-accent: #5b9dff;
	--packs-radius: 6px;
	background: var(--packs-bg);
	color: var(--packs-text);
	color-scheme: dark;
}

.packs[data-packs-frame-theme='light'] {
	--packs-bg: #f6f7f9;
	--packs-surface: #ffffff;
	--packs-border: #d4d9e2;
	--packs-control-border: #667085;
	--packs-text: #1b1f24;
	--packs-text-muted: #596273;
	--packs-accent: #1769e0;
	color-scheme: light;
}

.packs {
	display: flex;
	flex-direction: column;
	gap: 12px;
	box-sizing: border-box;
	min-height: 100vh;
	padding: 20px;
	font-size: 15px;
}

.packs-title {
	margin: 0;
	font-size: 22px;
	line-height: 1.25;
}

.packs-intro,
.packs-note {
	margin: 4px 0 0;
	max-width: 70ch;
	color: var(--packs-text-muted);
	font-size: 14px;
}

.packs-note {
	margin: 0;
	font-size: 13px;
}

.packs-chooser {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 4px 20px;
	margin: 0;
	padding: 8px 12px;
	border: 1px solid var(--packs-border);
	border-radius: var(--packs-radius);
	background: var(--packs-surface);
}

.packs-chooser-legend {
	padding: 0 4px;
	font-size: 13px;
	color: var(--packs-text-muted);
}

.packs-chooser-option {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	min-height: 28px;
	cursor: pointer;
}

.packs-chooser-option input {
	width: 16px;
	height: 16px;
	margin: 0;
	accent-color: var(--packs-accent);
}

.packs-chooser-option input:focus-visible {
	outline: 2px solid var(--packs-accent);
	outline-offset: 2px;
}

.packs-panes {
	display: grid;
	grid-template-columns: minmax(0, 1fr);
	gap: 16px;
	align-items: start;
}

.packs-panes[data-layout='both'] {
	grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
}

.packs-pane {
	display: flex;
	flex-direction: column;
	gap: 8px;
	min-width: 0;
}

.packs-pane-title {
	margin: 0;
	font-size: 13px;
	font-weight: 600;
	letter-spacing: 0.04em;
	text-transform: uppercase;
	color: var(--packs-text-muted);
}

.packs-loading {
	margin: 0;
	font-size: 14px;
	color: var(--packs-text-muted);
}
</style>
