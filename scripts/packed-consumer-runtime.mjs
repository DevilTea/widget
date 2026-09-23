import {
	createWidgetDocument,
	createWidgetPlugin,
	createWidgetSystem,
} from '@deviltea/widget-core'
import {
	inspectBlueprint,
	inspectRuntime,
} from '@deviltea/widget-core/inspection'
import { getWidgetEventEmitter } from '@deviltea/widget-core/integration'
import {
	createWidgetVueRenderer,
	useWidget,
} from '@deviltea/widget-vue'

const exportedFunctions = [
	['@deviltea/widget-core:createWidgetDocument', createWidgetDocument],
	['@deviltea/widget-core:createWidgetPlugin', createWidgetPlugin],
	['@deviltea/widget-core:createWidgetSystem', createWidgetSystem],
	['@deviltea/widget-core/inspection:inspectBlueprint', inspectBlueprint],
	['@deviltea/widget-core/inspection:inspectRuntime', inspectRuntime],
	['@deviltea/widget-core/integration:getWidgetEventEmitter', getWidgetEventEmitter],
	['@deviltea/widget-vue:createWidgetVueRenderer', createWidgetVueRenderer],
	['@deviltea/widget-vue:useWidget', useWidget],
]

for (const [name, exported] of exportedFunctions) {
	if (typeof exported !== 'function')
		throw new TypeError(`Expected ${name} to be a function, got ${typeof exported}.`)
}

console.log(`Packed runtime smoke passed for ${exportedFunctions.length} named exports across all public subpaths.`)
