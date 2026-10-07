import type { InspectorGeometryRect } from './protocol'

/** Marks the Agent-owned overlay host so geometry observation can ignore Agent chrome. */
export const INSPECTOR_OVERLAY_HOST_ATTRIBUTE = 'data-widget-inspector-overlay'
export const INSPECTOR_OVERLAY_HOST_SELECTOR = `[${INSPECTOR_OVERLAY_HOST_ATTRIBUTE}="true"]`

// Presentation is overridable from the inspected document through inherited custom properties
// (custom properties cross the ShadowRoot boundary); everything else is Agent-owned and isolated.
const OVERLAY_STYLE = `
:host {
	all: initial;
	pointer-events: none;
}
* {
	box-sizing: border-box;
	pointer-events: none;
}
.rect {
	position: fixed;
	outline: 2px solid var(--widget-inspector-accent, #2563eb);
	outline-offset: 1px;
	background: var(--widget-inspector-fill, rgb(37 99 235 / 12%));
}
.badge {
	position: fixed;
	padding: 2px 6px;
	font: 600 10px/1.4 system-ui, sans-serif;
	white-space: nowrap;
	border-radius: 4px;
	background: var(--widget-inspector-accent, #2563eb);
	color: var(--widget-inspector-accent-contrast, #fff);
	transform: translateY(-100%);
}
.badge.inside {
	transform: none;
}
`

export interface InspectorOverlayContent {
	readonly label: string
	readonly rects: readonly InspectorGeometryRect[]
}

export interface InspectorOverlay {
	/** Draws the rects/label, creating the host lazily. Re-drawing identical content mutates nothing. */
	show: (content: InspectorOverlayContent) => void
	/** Removes the host entirely: no Agent DOM is left behind while nothing is highlighted. */
	clear: () => void
}

function signature(content: InspectorOverlayContent): string {
	return `${content.label}|${content.rects.map(rect => `${rect.x},${rect.y},${rect.width},${rect.height}`)
		.join(';')}`
}

/**
 * Agent-owned highlight chrome. The overlay lives in a ShadowRoot attached to a single fixed,
 * pointer-transparent host appended to the inspected document, outside the renderer's element tree:
 * it never mutates renderer elements, and a renderer re-render cannot clear it. Rects are
 * `preview-viewport` client rects, which coincide with the fixed host's coordinate space.
 */
export function createInspectorOverlay(ownerDocument: Document): InspectorOverlay {
	let host: HTMLElement | null = null
	let content: HTMLElement | null = null
	let lastSignature: string | null = null

	function ensureHost(): HTMLElement {
		if (host !== null && content !== null) {
			if (!host.isConnected)
				(ownerDocument.body ?? ownerDocument.documentElement).append(host)
			return content
		}
		const created = ownerDocument.createElement('div')
		created.setAttribute(INSPECTOR_OVERLAY_HOST_ATTRIBUTE, 'true')
		created.setAttribute('aria-hidden', 'true')
		created.style.cssText = 'all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;'
		const shadow = created.attachShadow({ mode: 'open' })
		const style = ownerDocument.createElement('style')
		style.textContent = OVERLAY_STYLE
		const container = ownerDocument.createElement('div')
		shadow.append(style, container)
		;(ownerDocument.body ?? ownerDocument.documentElement).append(created)
		host = created
		content = container
		return container
	}

	return {
		show(next) {
			const nextSignature = signature(next)
			if (host !== null && host.isConnected && nextSignature === lastSignature)
				return
			const container = ensureHost()
			lastSignature = nextSignature
			const children: HTMLElement[] = []
			for (const rect of next.rects) {
				const box = ownerDocument.createElement('div')
				box.className = 'rect'
				box.style.left = `${rect.x}px`
				box.style.top = `${rect.y}px`
				box.style.width = `${rect.width}px`
				box.style.height = `${rect.height}px`
				children.push(box)
			}
			const first = next.rects[0]
			if (first !== undefined) {
				const badge = ownerDocument.createElement('div')
				// Keep the label visible when the Widget starts at the very top of the viewport.
				badge.className = first.y < 20 ? 'badge inside' : 'badge'
				badge.textContent = next.label
				badge.style.left = `${first.x}px`
				badge.style.top = `${first.y}px`
				children.push(badge)
			}
			container.replaceChildren(...children)
		},
		clear() {
			host?.remove()
			host = null
			content = null
			lastSignature = null
		},
	}
}
