/**
 * better-tailwindcss 配置片段（flat config）
 *
 * 粘贴进 eslint.config.mjs 的主规则配置块。Nuxt 项目改放 withNuxt() 参数内，
 * entryPoint 指向 app 的 CSS 入口（如 app/assets/css/main.css）。
 *
 * 排序语义：
 * - Tailwind 类按官方语义序（order: 'official'）
 * - 未知类（layout-/page-/cmpt- 等自定义标记类）自动排最前且保持原相对顺序
 *   —— 这是 unknownClassPosition/unknownClassOrder 的默认行为，显式写出是为可读性
 */
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import eslintPluginBetterTailwindcss from 'eslint-plugin-better-tailwindcss'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default {
  plugins: {
    'better-tailwindcss': eslintPluginBetterTailwindcss
  },
  settings: {
    'better-tailwindcss': {
      // Tailwind v4：CSS 入口文件绝对路径（含 @import "tailwindcss" 的文件）
      entryPoint: resolve(__dirname, './src/assets/main.css')
      // Tailwind v3 改用：tailwindConfig: resolve(__dirname, './tailwind.config.js')
    }
  },
  rules: {
    'better-tailwindcss/enforce-consistent-class-order': ['warn', {
      order: 'official',
      unknownClassPosition: 'start',
      unknownClassOrder: 'preserve'
    }],
    // 默认关闭：项目常有未装插件的迁移残留类/裸 CSS 类，开启前评估噪音（可用 ignore 正则豁免）
    'better-tailwindcss/no-unknown-classes': 'off',
    'better-tailwindcss/no-conflicting-classes': 'error',
    'better-tailwindcss/no-duplicate-classes': 'warn',
    'better-tailwindcss/enforce-shorthand-classes': 'warn',
    'better-tailwindcss/no-unnecessary-whitespace': 'warn'
  }
}
