import type { UserConfig } from 'vitest/config'

// 仅使用类型，避免配置加载经过 Windows Global junction 运行时导入 Vitest。
export default {
  test: {
    // 搬来的 spec 沿用 jest 的隐式全局（describe / it / expect），不加 import。
    globals: true,
    include: ['tests/**/*.spec.ts'],
  },
} satisfies UserConfig
