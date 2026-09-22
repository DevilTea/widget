import type {
	InspectorGeometrySnapshot,
	InspectorHitTestResult,
	InspectorPreviewPoint,
	InspectorSemanticTarget,
	WidgetRef,
} from './protocol'

const ANCHOR_SELECTOR = '[data-widget-id][data-widget-type]'

export interface SemanticGeometryControllerOptions {
	readonly root: HTMLElement
	readonly resolveRef: (ref: WidgetRef) => InspectorSemanticTarget | null
	readonly resolveAnchor: (element: Element) => InspectorSemanticTarget | null
	readonly onInvalidated: (revision: number) => void
}

export interface SemanticGeometryController {
	readonly revision: number
	resolve: (ref: WidgetRef) => InspectorGeometrySnapshot
	hitTest: (point: InspectorPreviewPoint) => InspectorHitTestResult
	dispose: () => void
}

function geometryRect(rect: DOMRect | DOMRectReadOnly): { x: number, y: number, width: number, height: number } {
	return {
		x: Number.isFinite(rect.x) ? rect.x : rect.left,
		y: Number.isFinite(rect.y) ? rect.y : rect.top,
		width: rect.width,
		height: rect.height,
	}
}

function usableRect(rect: { width: number, height: number }): boolean {
	return Number.isFinite(rect.width) && Number.isFinite(rect.height) && rect.width > 0 && rect.height > 0
}

export function createSemanticGeometryController(options: SemanticGeometryControllerOptions): SemanticGeometryController {
	const document = options.root.ownerDocument
	const window = document.defaultView
	let revision = 0
	let invalidationPending = false
	let frameHandle: number | null = null
	let disposed = false

	function viewportSize(): { width: number, height: number } {
		return {
			width: window?.innerWidth ?? document.documentElement.clientWidth,
			height: window?.innerHeight ?? document.documentElement.clientHeight,
		}
	}

	function allAnchors(): Element[] {
		const result: Element[] = []
		if (options.root.matches(ANCHOR_SELECTOR))
			result.push(options.root)
		result.push(...options.root.querySelectorAll(ANCHOR_SELECTOR))
		return result
	}

	function targetAnchors(target: InspectorSemanticTarget): Element[] {
		return allAnchors()
			.filter(element =>
				element.getAttribute('data-widget-id') === target.widgetId
				&& element.getAttribute('data-widget-type') === target.widgetType,
			)
	}

	function rectsForTarget(target: InspectorSemanticTarget): readonly { x: number, y: number, width: number, height: number }[] {
		const rects: { x: number, y: number, width: number, height: number }[] = []
		for (const element of targetAnchors(target)) {
			for (const rect of element.getClientRects()) {
				const projected = geometryRect(rect)
				if (usableRect(projected))
					rects.push(projected)
			}
		}
		return rects
	}

	function snapshotForTarget(target: InspectorSemanticTarget | null): InspectorGeometrySnapshot {
		if (target === null) {
			return {
				coordinateSpace: 'preview-viewport',
				revision,
				visibility: 'missing',
				rects: [],
			}
		}

		const rects = rectsForTarget(target)
		if (rects.length === 0) {
			return {
				coordinateSpace: 'preview-viewport',
				revision,
				visibility: 'hidden',
				rects,
			}
		}

		const viewport = viewportSize()
		const fullyInside = rects.every(rect =>
			rect.x >= 0
			&& rect.y >= 0
			&& rect.x + rect.width <= viewport.width
			&& rect.y + rect.height <= viewport.height,
		)
		return {
			coordinateSpace: 'preview-viewport',
			revision,
			visibility: fullyInside ? 'visible' : 'clipped',
			rects,
		}
	}

	function nearestSemanticAnchor(element: Element): InspectorSemanticTarget | null {
		const anchor = element.closest(ANCHOR_SELECTOR)
		if (anchor === null || !options.root.contains(anchor))
			return null
		return options.resolveAnchor(anchor)
	}

	function fallbackHitTarget(point: InspectorPreviewPoint): InspectorSemanticTarget | null {
		let selected: Element | null = null
		for (const anchor of allAnchors()) {
			const containsPoint = [...anchor.getClientRects()].some(rect =>
				point.x >= rect.left
				&& point.x <= rect.right
				&& point.y >= rect.top
				&& point.y <= rect.bottom,
			)
			if (!containsPoint || options.resolveAnchor(anchor) === null)
				continue
			if (selected === null || selected.contains(anchor))
				selected = anchor
		}
		return selected === null ? null : options.resolveAnchor(selected)
	}

	function hitTarget(point: InspectorPreviewPoint): InspectorSemanticTarget | null {
		const viewport = viewportSize()
		if (point.x < 0 || point.y < 0 || point.x >= viewport.width || point.y >= viewport.height)
			return null

		const elementsFromPoint = document.elementsFromPoint?.bind(document)
		if (elementsFromPoint !== undefined) {
			for (const element of elementsFromPoint(point.x, point.y)) {
				const target = nearestSemanticAnchor(element)
				if (target !== null)
					return target
			}
			return null
		}
		return fallbackHitTarget(point)
	}

	function scheduleInvalidation(): void {
		if (disposed || invalidationPending)
			return
		invalidationPending = true
		revision++
		if (window === null) {
			queueMicrotask(() => {
				if (disposed)
					return
				invalidationPending = false
				options.onInvalidated(revision)
			})
			return
		}
		frameHandle = window.requestAnimationFrame(() => {
			frameHandle = null
			if (disposed)
				return
			invalidationPending = false
			options.onInvalidated(revision)
		})
	}

	const onScroll = (): void => scheduleInvalidation()
	const onResize = (): void => scheduleInvalidation()
	const onResourceLoad = (): void => scheduleInvalidation()
	document.addEventListener('scroll', onScroll, true)
	options.root.addEventListener('load', onResourceLoad, true)
	window?.addEventListener('resize', onResize)

	const mutationObserver = typeof MutationObserver === 'function'
		? new MutationObserver(() => scheduleInvalidation())
		: null
	mutationObserver?.observe(options.root, {
		subtree: true,
		childList: true,
		attributes: true,
		characterData: true,
	})

	const resizeObserver = typeof ResizeObserver === 'function'
		? new ResizeObserver(() => scheduleInvalidation())
		: null

	function observeAnchorSizes(): void {
		if (resizeObserver === null)
			return
		resizeObserver.disconnect()
		resizeObserver.observe(options.root)
		for (const anchor of allAnchors())
			resizeObserver.observe(anchor)
	}
	observeAnchorSizes()

	const anchorRefreshObserver = resizeObserver === null || typeof MutationObserver !== 'function'
		? null
		: new MutationObserver(() => observeAnchorSizes())
	anchorRefreshObserver?.observe(options.root, { subtree: true, childList: true })

	const fontSet = document.fonts
	const onFontLayout = (): void => scheduleInvalidation()
	fontSet?.addEventListener('loadingdone', onFontLayout)
	fontSet?.addEventListener('loadingerror', onFontLayout)

	return {
		get revision() {
			return revision
		},
		resolve(ref) {
			return snapshotForTarget(options.resolveRef(ref))
		},
		hitTest(point) {
			const target = hitTarget(point)
			if (target === null)
				return { target: null }
			return { target, geometry: snapshotForTarget(target) }
		},
		dispose() {
			if (disposed)
				return
			disposed = true
			document.removeEventListener('scroll', onScroll, true)
			options.root.removeEventListener('load', onResourceLoad, true)
			window?.removeEventListener('resize', onResize)
			mutationObserver?.disconnect()
			anchorRefreshObserver?.disconnect()
			resizeObserver?.disconnect()
			fontSet?.removeEventListener('loadingdone', onFontLayout)
			fontSet?.removeEventListener('loadingerror', onFontLayout)
			if (frameHandle !== null && window !== null)
				window.cancelAnimationFrame(frameHandle)
		},
	}
}
