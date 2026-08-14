#!/usr/bin/env node
/**
 * Generates `src/pika.gen.ts` (and `src/pika.gen.css`) without a full Vite build.
 *
 * `@pikacss/unplugin-pikacss` normally writes both files as a side effect of its Vite plugin's
 * `buildStart` hook (see the "Frameworks" doc: the generated `pika.gen.ts` augments Vue's
 * `ComponentCustomProperties` so `pika()` type-checks inside `<template>`). `vue-tsc`/`tsc` never run
 * through Vite, so `pnpm typecheck` runs this script first to produce the same file directly through
 * `@pikacss/integration`'s programmatic API — keeping `pnpm typecheck` correct on a clean checkout
 * without requiring a prior `pnpm dev`/`pnpm build`.
 *
 * Options mirror `vite.config.ts`'s `pikacss()` call and the unplugin's own defaults; keep both in
 * sync if either changes.
 */
import process from 'node:process'
import { createCtx } from '@pikacss/integration'

const ctx = createCtx({
	cwd: process.cwd(),
	currentPackageName: '@pikacss/unplugin-pikacss',
	scan: {
		include: ['**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx,vue}'],
		exclude: ['node_modules/**', 'dist/**', '.git/**'],
	},
	configOrPath: null,
	fnName: 'pika',
	transformedFormat: 'string',
	tsCodegen: './src/pika.gen.ts',
	cssCodegen: './src/pika.gen.css',
	autoCreateConfig: false,
})

await ctx.setup()
await ctx.writeTsCodegenFile()
await ctx.writeCssCodegenFile()
