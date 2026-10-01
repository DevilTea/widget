import type { PreviewFrameConnection, PreviewFrameDriver } from './frame-driver'
import { describe, expect, it, vi } from 'vitest'
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

function driverOf(mount: PreviewFrameDriver['mount']): PreviewFrameDriver {
	return {
		mount,
		updatePresentation: () => {},
		setTutorialSpotlight: () => {},
		evaluateTutorial: async (_tour, _step, progress) => progress,
		onTutorialObservation: () => () => {},
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

		coordinator.setTutorialSpotlight('survey-adults')
		await coordinator.replace({ showcaseId: 'survey', revision: 1, sourceText: '{}' })

		expect(spotlight)
			.toHaveBeenLastCalledWith('survey-adults')
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
				throw new Error('frame mount failed')
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
})
