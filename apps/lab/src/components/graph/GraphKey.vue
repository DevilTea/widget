<script setup lang="ts">
/**
 * The always-visible key of the Graph (audit U11): what the badges on a member (S, P, M, W, E, !) and the three line
 * styles mean, in one row above the canvas, so none of it needs the Legend popover. It states only what
 * `GraphCanvas.vue` renders: the same letters, the same kind colours (State = ok, Property = warning, Method =
 * accent) and the same strokes. The Legend still has the long form.
 */
import { useLabI18n } from '../../composables/use-lab-i18n'

const i18n = useLabI18n()
</script>

<template>
	<ul
		data-testid="graph-key"
		:aria-label="i18n.t('Graph key')"
		class="m-0 flex flex-none list-none flex-wrap items-center gap-x-3 gap-y-1 border-b border-default bg-muted px-2 py-1 text-[11px] text-default"
	>
		<li class="flex items-center gap-1">
			<span class="graph-key-badge graph-key-badge--state">S</span>State
		</li>
		<li class="flex items-center gap-1">
			<span class="graph-key-badge graph-key-badge--property">P</span>Property
		</li>
		<li class="flex items-center gap-1">
			<span class="graph-key-badge graph-key-badge--method">M</span>Method
		</li>
		<li class="flex items-center gap-1">
			<span class="graph-key-badge graph-key-badge--flag">W</span>{{ i18n.t('writes State') }}
		</li>
		<li class="flex items-center gap-1">
			<span class="graph-key-badge graph-key-badge--flag">E</span>{{ i18n.t('emits an Event') }}
		</li>
		<li class="flex items-center gap-1">
			<span class="graph-key-badge graph-key-badge--danger">!</span>{{ i18n.t('in an invalid cycle') }}
		</li>
		<li class="flex items-center gap-1">
			<span class="graph-key-line graph-key-line--reads" />reads
		</li>
		<li class="flex items-center gap-1">
			<span class="graph-key-line graph-key-line--writes" />writes
		</li>
		<li class="flex items-center gap-1">
			<span class="graph-key-line graph-key-line--invokes" />invokes
		</li>
	</ul>
</template>

<style scoped>
.graph-key-badge {
	display: inline-grid;
	place-items: center;
	min-width: 20px;
	height: 20px;
	padding: 0 4px;
	border: 1px solid color-mix(in srgb, var(--key-color) 50%, var(--lab-color-border));
	border-radius: 6px;
	background: color-mix(in srgb, var(--key-color) 10%, var(--lab-color-surface));
	color: var(--lab-color-text);
	font-family: var(--lab-font-mono);
	font-size: 11px;
	font-weight: 800;
	line-height: 1;
}

.graph-key-badge--state {
	--key-color: var(--lab-color-ok);
}

.graph-key-badge--property,
.graph-key-badge--flag {
	--key-color: var(--lab-color-warning);
}

.graph-key-badge--method {
	--key-color: var(--lab-color-accent);
}

.graph-key-badge--danger {
	--key-color: var(--lab-color-danger);
}

.graph-key-line {
	width: 22px;
	height: 0;
	flex: 0 0 22px;
	border-top: 1.2px solid var(--lab-color-text-muted);
}

.graph-key-line--writes {
	border-top-width: 2px;
	border-top-color: color-mix(in srgb, var(--lab-color-warning) 76%, var(--lab-color-text-muted));
}

.graph-key-line--invokes {
	border-top-width: 1.5px;
	border-top-style: dashed;
	border-top-color: color-mix(in srgb, var(--lab-color-accent) 74%, var(--lab-color-text-muted));
}
</style>
