import { defineConfig } from 'tsdown'

export default defineConfig({
	entry: ['src/index.ts', 'src/inspection/index.ts'],
	format: 'esm',
	target: 'es2022',
	dts: {
		tsconfig: './tsconfig.package.json',
	},
	clean: true,
	publint: true,
})
