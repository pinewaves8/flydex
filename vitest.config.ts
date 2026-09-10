import { defineConfig, mergeConfig } from 'vitest/config'

import viteConfig from './vite.config'

/**
 * 单元测试配置
 *
 * 复用 `vite.config.ts` —— 主要是为了 `@/` 别名,测试里 import 的路径要和源码一致,
 * 否则测的就不是同一个模块了。
 *
 * `environment: 'node'`:目前测的都是**纯函数**(item 映射、导出渲染、路径归一),
 * 不需要 DOM,所以不引入 jsdom。将来要测组件再按需切换。
 */
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts'],
      // 这些是纯函数测试,不应该有副作用;串行跑便于定位
      reporters: 'default',
    },
  }),
)
