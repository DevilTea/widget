<script setup lang="ts">
/**
 * vue-tsc (strictTemplates) checks `<WidgetSlot name="...">` as `new WidgetSlot({ name: '...' })`: the scoped
 * `type` must be narrowed to the named slot's expected plugin types. Never run or published.
 */
import { useWidget } from '../src/index'
import { expectType, HostPlugin } from './slot-host'

const { WidgetSlot } = useWidget(HostPlugin)

const isLabel = expectType<'Label'>()
const isLabelOrCounter = expectType<'Label' | 'Counter'>()
const isLeaf = expectType<'Leaf'>()
const isString = expectType<string>()
</script>

<template>
	<WidgetSlot
		v-slot="{ type, Child }"
		name="header"
	>
		<component :is="Child" />
		<span>{{ isLabel(type) }}</span>
	</WidgetSlot>
	<WidgetSlot
		v-slot="{ type, Child }"
		name="body"
	>
		<component :is="Child" />
		<span>{{ isLabelOrCounter(type) }}</span>
		<span>
			<!-- @vue-expect-error `body` also holds counters -->
			{{ isLabel(type) }}
		</span>
	</WidgetSlot>
	<WidgetSlot
		v-slot="{ type }"
		name="leaves"
	>
		<span>{{ isLeaf(type) }}</span>
	</WidgetSlot>
	<WidgetSlot
		v-slot="{ type }"
		name="free"
	>
		<span>{{ isString(type) }}</span>
		<span>
			<!-- @vue-expect-error `free` accepts any widget -->
			{{ isLabel(type) }}
		</span>
	</WidgetSlot>
	<!-- @vue-expect-error `nope` is not a declared slot -->
	<WidgetSlot name="nope" />
</template>
