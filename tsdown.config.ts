import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  dts: true,
  exports: true,
  publint: { level: 'error' },
  attw: { profile: 'esm-only', level: 'error' },
})
