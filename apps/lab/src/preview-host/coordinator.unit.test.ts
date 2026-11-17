import type { PreviewFrameConnection, PreviewFrameDriver } from './frame-driver'
import { describe, expect, it, vi } from 'vitest'
import { PreviewHostClientError } from './client'
import { createPreviewHostCoordinator } from './coordinator'

function connection(revision: number): PreviewFrameConnection {
	return {
		generation: 1,
		revision,
		runtimeId: `runtime-${revision}`,
		blueprint: { runtimeId: `runtime-${revision}`, rootNodeId: 0, nodes: [], invalidCycles: [] },
		inspectorClient: {} as PreviewFrameConnection['inspectorClient'],
		hostClient: {} as PreviewFrameConnection['hostClient'],
	}
}

function driverOf(mount: PreviewFrameDriver['mount'], closeListeners: Set<() => void> = new Set()): PreviewFrameDriver {
	return {
		mount,
		updatePresentation: () => {},
		setTutorialSpotlight: () => {},
		evaluateTutorial: async (_tour, _step, progress) => progress,
		onTutorialObservation: () => () => {},
		onUnexpectedClose: (listener) => {
			closeListeners.add(listener)
			return () => closeListeners.delete(listener)
		},
		dispose: () => {},
	}
}

function deferred<T>() {
	let resolve!: (value: T) => void
	let reject!: (reason?: unknown) => void
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise
		reject = rejectPromise
	})
	return { promise, reject, resolve }
}

describe('preview host coordinator', () => {
	it('accepts desired Preview state before a driver exists, then mounts the latest intent after attach', async () => {
		const coordinator = createPreviewHostCoordinator()
		await expect(coordinator.replace({ showcaseId: 'survey', revision: 1, sourceText: '{}' })).resolves.toBeNull()
		await expect(coordinator.replace({ showcaseId: 'survey', revision: 2, sourceText: '{}' })).resolves.toBeNull()
		expect(coordinator.connection.value)
			.toBeNull()

		const mount = vi.fn(async (descriptor: { revision: number }) => connection(descriptor.revision)) as unknown as PreviewFrameDriver['mount']
		coordinator.attachDriver(driverOf(mount))
		await vi.waitFor(() => expect(coordinator.connection.value?.revision)
			.toBe(2))
		expect(mount)
			.toHaveBeenCalledTimes(1)
		expect(mount)
			.toHaveBeenCalledWith(expect.objectContaining({ revision: 2 }))
		coordinator.dispose()
	})

	it('does not publish a superseded mount while the latest mount is pending', async () => {
		const coordinator = createPreviewHostCoordinator()
		const firstMount = deferred<PreviewFrameConnection>()
		const secondConnection = connection(2)
		const secondMount = deferred<PreviewFrameConnection>()
		const mount = vi.fn(({ revision }: { revision: number }) => revision === 1 ? firstMount.promise : secondMount.promise) as unknown as PreviewFrameDriver['mount']
		coordinator.attachDriver(driverOf(mount))

		const first = coordinator.replace({ showcaseId: 'survey', revision: 1, sourceText: '{}' })
		await vi.waitFor(() => expect(mount)
			.toHaveBeenCalledTimes(1))
		const second = coordinator.replace({ showcaseId: 'survey', revision: 2, sourceText: '{}' })

		firstMount.resolve(connection(1))
		await first
		await vi.waitFor(() => expect(mount)
			.toHaveBeenCalledTimes(2))
		// The second mount is still deferred here, so any current connection would be stale revision 1.
		expect(coordinator.connection.value)
			.toBeNull()

		secondMount.resolve(secondConnection)
		await second
		expect(coordinator.connection.value)
			.toBe(secondConnection)
		coordinator.dispose()
	})

	it('keeps a newer queued intent authoritative before the first queued mount starts', async () => {
		const coordinator = createPreviewHostCoordinator()
		const firstMount = deferred<PreviewFrameConnection>()
		const secondConnection = connection(2)
		const secondMount = deferred<PreviewFrameConnection>()
		const mount = vi.fn(({ revision }: { revision: number }) => revision === 1 ? firstMount.promise : secondMount.promise) as unknown as PreviewFrameDriver['mount']
		coordinator.attachDriver(driverOf(mount))

		const first = coordinator.replace({ showcaseId: 'survey', revision: 1, sourceText: '{}' })
		const second = coordinator.replace({ showcaseId: 'survey', revision: 2, sourceText: '{}' })
		await vi.waitFor(() => expect(mount)
			.toHaveBeenCalledTimes(1))

		firstMount.resolve(connection(1))
		await expect(first)
			.resolves.toBeNull()
		await vi.waitFor(() => expect(mount)
			.toHaveBeenCalledTimes(2))
		expect(coordinator.connection.value)
			.toBeNull()

		secondMount.resolve(secondConnection)
		await expect(second)
			.resolves.toBe(secondConnection)
		expect(coordinator.connection.value)
			.toBe(secondConnection)
		coordinator.dispose()
	})

	it('ignores a rejected queued mount that was superseded before it started', async () => {
		const coordinator = createPreviewHostCoordinator()
		const firstMount = deferred<PreviewFrameConnection>()
		const secondConnection = connection(2)
		const secondMount = deferred<PreviewFrameConnection>()
		const mount = vi.fn(({ revision }: { revision: number }) => revision === 1 ? firstMount.promise : secondMount.promise) as unknown as PreviewFrameDriver['mount']
		coordinator.attachDriver(driverOf(mount))

		const first = coordinator.replace({ showcaseId: 'survey', revision: 1, sourceText: '{}' })
		const second = coordinator.replace({ showcaseId: 'survey', revision: 2, sourceText: '{}' })
		await vi.waitFor(() => expect(mount)
			.toHaveBeenCalledTimes(1))

		firstMount.reject(new Error('stale mount failed'))
		await expect(first)
			.resolves.toBeNull()
		expect(coordinator.error.value)
			.toBeNull()
		await vi.waitFor(() => expect(mount)
			.toHaveBeenCalledTimes(2))

		secondMount.resolve(secondConnection)
		await expect(second)
			.resolves.toBe(secondConnection)
		expect(coordinator.connection.value)
			.toBe(secondConnection)
		expect(coordinator.error.value)
			.toBeNull()
		coordinator.dispose()
	})

	it('replays the current tutorial spotlight after a remote Preview replacement', async () => {
		const coordinator = createPreviewHostCoordinator()
		const spotlight = vi.fn()
		const mount = vi.fn(async (descriptor: { revision: number }) => connection(descriptor.revision)) as unknown as PreviewFrameDriver['mount']
		coordinator.attachDriver({ ...driverOf(mount), setTutorialSpotlight: spotlight })

		coordinator.setTutorialSpotlight('survey-mode')
		await coordinator.replace({ showcaseId: 'survey', revision: 1, sourceText: '{}' })

		expect(spotlight)
			.toHaveBeenLastCalledWith('survey-mode')
		coordinator.dispose()
	})

	it('serializes replacements and keeps a failed remote mount out of the ready connection', async () => {
		const coordinator = createPreviewHostCoordinator()
		let release: (() => void) | null = null
		const firstGate = new Promise<void>((resolve) => {
			release = resolve
		})
		const mount = vi.fn(async (descriptor: { revision: number }) => {
			if (descriptor.revision === 1)
				await firstGate
			if (descriptor.revision === 3)
				throw new PreviewHostClientError('frame mount failed', true)
			return connection(descriptor.revision)
		}) as unknown as PreviewFrameDriver['mount']
		coordinator.attachDriver(driverOf(mount))

		const first = coordinator.replace({ showcaseId: 'survey', revision: 1, sourceText: '{}' })
		await vi.waitFor(() => expect(mount)
			.toHaveBeenCalledTimes(1))
		const second = coordinator.replace({ showcaseId: 'survey', revision: 2, sourceText: '{}' })
		release!()
		await first
		await second
		expect(mount)
			.toHaveBeenCalledTimes(2)
		expect(coordinator.connection.value?.revision)
			.toBe(2)

		await expect(coordinator.replace({ showcaseId: 'survey', revision: 3, sourceText: '{}' })).rejects.toThrow('frame mount failed')
		expect(coordinator.connection.value?.revision)
			.toBe(2)
		expect(coordinator.error.value)
			.toBe('frame mount failed')

		await expect(coordinator.replace({ showcaseId: 'survey', revision: 4, sourceText: '{}' }))
			.resolves.toMatchObject({ revision: 4 })
		expect(coordinator.connection.value?.revision)
			.toBe(4)
		expect(coordinator.error.value)
			.toBeNull()
		coordinator.dispose()
	})

	it('keeps a failed mount as the error and publishes the next request when it works (audit U22)', async () => {
		const coordinator = createPreviewHostCoordinator()
		let attempts = 0
		const mount = vi.fn(async ({ revision }: { revision: number }) => {
			attempts++
			if (attempts === 1)
				throw new Error('Preview iframe did not become ready within 1000 ms.')
			return connection(revision)
		}) as unknown as PreviewFrameDriver['mount']
		coordinator.attachDriver(driverOf(mount))

		await expect(coordinator.replace({ showcaseId: 'survey', revision: 3, sourceText: '{}' }))
			.rejects
			.toThrow('did not become ready')
		expect(coordinator.error.value)
			.toBe('Preview iframe did not become ready within 1000 ms.')
		expect(coordinator.connection.value)
			.toBeNull()
		expect(coordinator.runtimeSurvives.value)
			.toBe(false)

		const retried = await coordinator.replace({ showcaseId: 'survey', revision: 3, sourceText: '{}' })
		expect(retried?.revision)
			.toBe(3)
		expect(coordinator.error.value)
			.toBeNull()
		expect(coordinator.connection.value?.revision)
			.toBe(3)
		coordinator.dispose()
	})

	it('a timeout drops the connection the Lab held, but a refusal the frame answered keeps the Runtime that still runs', async () => {
		const coordinator = createPreviewHostCoordinator()
		let attempt = 0
		const mount = vi.fn(async ({ revision }: { revision: number }) => {
			attempt++
			if (attempt === 2)
				throw new PreviewHostClientError('Unknown Preview showcase: nope.', true)
			if (attempt === 3)
				throw new Error('Preview iframe did not become ready within 1000 ms.')
			return connection(revision)
		}) as unknown as PreviewFrameDriver['mount']
		coordinator.attachDriver(driverOf(mount))
		await coordinator.replace({ showcaseId: 'survey', revision: 1, sourceText: '{}' })

		await expect(coordinator.replace({ showcaseId: 'nope', revision: 2, sourceText: '{}' }))
			.rejects
			.toThrow('Unknown Preview showcase')
		// The frame answered, so it still runs revision 1.
		expect(coordinator.connection.value?.revision)
			.toBe(1)
		expect(coordinator.runtimeSurvives.value)
			.toBe(true)

		await expect(coordinator.replace({ showcaseId: 'survey', revision: 3, sourceText: '{}' }))
			.rejects
			.toThrow('did not become ready')
		expect(coordinator.connection.value)
			.toBeNull()
		expect(coordinator.runtimeSurvives.value)
			.toBe(false)
		coordinator.dispose()
	})

	it('drops the connection and reports an error when the frame closes by itself, and recovers on the next mount', async () => {
		const coordinator = createPreviewHostCoordinator()
		const closeListeners = new Set<() => void>()
		const mount = vi.fn(async ({ revision }: { revision: number }) => connection(revision)) as unknown as PreviewFrameDriver['mount']
		coordinator.attachDriver(driverOf(mount, closeListeners))
		await coordinator.replace({ showcaseId: 'survey', revision: 1, sourceText: '{}' })
		expect(coordinator.connection.value?.revision)
			.toBe(1)

		for (const listener of closeListeners)
			listener()
		expect(coordinator.connection.value)
			.toBeNull()
		expect(coordinator.error.value)
			.toBe('The connection to the preview frame was closed.')

		await coordinator.replace({ showcaseId: 'survey', revision: 1, sourceText: '{}' })
		expect(coordinator.connection.value?.revision)
			.toBe(1)
		expect(coordinator.error.value)
			.toBeNull()
		coordinator.dispose()
	})
})
