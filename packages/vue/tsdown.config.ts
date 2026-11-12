import { defineConfig } from 'tsdown'

export default defineConfig({
	// Exactly the public subpaths; `context` (the private injection key) is only reachable through their shared chunk.
	entry: ['src/index.ts', 'src/testing.ts'],
	format: 'esm',
	target: 'es2022',
	dts: {
		tsconfig: './tsconfig.package.json',
	},
	clean: true,
	publint: true,
	deps: {
		// Core is a peerDependency: a bundled second copy would make the root renderer reject the host's Runtime.
		neverBundle: ['vue', /^@deviltea\/widget-core(?:\/|$)/],
	},
})
