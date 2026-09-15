import { defineConfig } from 'vitest/config'

export default defineConfig({
  // .tsx 源码(components.tsx 等)在测试里走 automatic JSX 运行时:
  // tsconfig 的 jsx:"preserve" 会让 esbuild 退回 classic(要求源码显式 import React,
  // 但源码普遍只有 type-only 导入)。仅影响 vitest 转换,plasmo 构建不受影响。
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['tests/setup.ts'],
  },
})
