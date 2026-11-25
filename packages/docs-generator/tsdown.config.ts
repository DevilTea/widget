import { defineConfig } from 'tsdown'

export default defineConfig({
	// The public subpaths (`.`, `./docs`, `./runtime`, `./vite`) and the bin (`cli`). `runtime-facts` is an internal entry:
	// `runtime-worker.mjs`, copied next to it, imports it by that stable name (`collectRuntimeFacts`). Every other module
	// is only reachable through these entries' shared chunks.
	entry: {
		'index': 'src/index.ts',
		'docs': 'src/docs-types.ts',
		'runtime': 'src/runtime.ts',
		'vite': 'src/vite.ts',
		'cli': 'src/cli.ts',
		'runtime-facts': 'src/runtime-facts.ts',
	},
	format: 'esm',
	target: 'es2022',
	dts: {
		tsconfig: './tsconfig.package.json',
	},
	// The worker is plain JavaScript started by URL (`importRuntimeFacts`), never imported: it is copied as written.
	copy: ['src/runtime-worker.mjs'],
	clean: true,
	publint: true,
	deps: {
		// Core is a peerDependency: a bundled second copy would brand plugins the System's own Core does not accept.
		neverBundle: [/^@deviltea\/widget-core(?:\/|$)/],
	},
})
