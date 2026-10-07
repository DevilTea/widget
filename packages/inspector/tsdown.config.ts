import { defineConfig } from 'tsdown'

export default defineConfig({
	// Exactly the public subpaths. `projection`, `geometry`, `validation`, `overlay`, and
	// `test-fixture` stay internal and are only reachable through these entries' shared chunks.
	entry: [
		'src/agent.ts',
		'src/anchor.ts',
		'src/channel.ts',
		'src/client.ts',
		'src/frame-bootstrap.ts',
		'src/protocol.ts',
		'src/transport.ts',
		'src/value.ts',
	],
	format: 'esm',
	target: 'es2022',
	dts: {
		tsconfig: './tsconfig.package.json',
	},
	clean: true,
	publint: true,
	deps: {
		// Core is a peerDependency: a bundled second copy would make `inspectRuntime` reject the host's Runtime.
		neverBundle: [/^@deviltea\/widget-core(?:\/|$)/],
	},
})
