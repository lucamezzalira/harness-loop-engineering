import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'examples/10-newsletter/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/**/*.ts', 'examples/10-newsletter/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'examples/10-newsletter/**/*.test.ts'],
    },
  },
})
