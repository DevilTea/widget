<script setup lang="ts">
/**
 * The Events a plugin declares: name and description, rendered verbatim (the description is the one written in the plugin's `.events()`,
 * from the showcase's generated documentation, and never passes through the Lab's i18n; an undocumented Event shows its name
 * only). Core publishes nothing else about an Event, in particular no payload schema, so the list says no more; what an
 * Event carries is whatever its description says and what the live Events log shows.
 * Used by the Catalog and by the Blueprint / Selected widget declaration. Presentation only.
 */
import { useLabI18n } from '../../composables/use-lab-i18n'

defineProps<{
	events: readonly { readonly name: string, readonly description: string }[]
	/** Whether the plugin declares the Events capability at all (an explicitly empty one still declares it). */
	declared: boolean
}>()

const i18n = useLabI18n()
</script>

<template>
	<ul
		v-if="events.length > 0"
		data-testid="declared-events"
		class="m-0 list-none p-0 text-[11px]"
	>
		<li
			v-for="event in events"
			:key="event.name"
			data-testid="declared-event"
			:data-event="event.name"
			class="mb-1 last:mb-0"
		>
			<code class="font-mono">{{ event.name }}</code><template v-if="event.description !== ''">
				<span class="text-muted">: </span>{{ event.description }}
			</template>
		</li>
	</ul>
	<p
		v-else
		data-testid="declared-events-none"
		class="m-0 text-[11px] text-muted"
	>
		{{ declared ? i18n.t('The Events capability is declared, with no Events.') : i18n.t('No Events capability.') }}
	</p>
</template>
