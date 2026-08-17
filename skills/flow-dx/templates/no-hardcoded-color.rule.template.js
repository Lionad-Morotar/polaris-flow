/**
 * ESLint 规则：禁止硬编码颜色值（flow-dx lint-infra 模板）
 *
 * 项目化调整点（复制到 <repo-root>/eslint-plugin-<org>/rules/no-hardcoded-color.js 后逐项过）：
 * ① 颜色→Token 建议表经 flat config option 注入，不改规则本体：
 *    'no-hardcoded-color': ['error', { suggestions: { '#ff8400': 'text-primary / bg-primary' } }]
 *    suggestions 的 key 必须小写（规则比对前统一 toLowerCase）；未命中的颜色走通用兜底文案
 * ② Token 定义源文件必须豁免——规则对含 hex 定义的文件自举：
 *    css 层 ignores 掉 design-tokens.css / @theme 入口（分层配置示例见 lint-infra.md「硬编码颜色规则」）
 * ③ 测试 fixture 层建议关闭：tests/** 的颜色是被测组件行为的一部分，不纳入设计系统治理
 * ④ .css 文件需单独一层配 @eslint/css 的 parser 才可被 ESLint 解析；.ts/.vue 层无需额外 parser
 * ⑤ 白名单按需扩展：WHITELIST_EXACT（精确值）、isDigitChannels（纯数字通道串，如 glowColor: '40 80 80'）
 * ⑥ 自举边界：本头注释与规则本体含色值样例，而本规则全文扫描含注释——若项目 lint 范围
 *    覆盖本插件目录的 .js，需对规则目录关闭本规则（或把样例拆写成 'ff' + '8400' 形态）
 *
 * ────────────────────────────────────────────────────────────────
 *
 * 实现策略：在 Program 节点对文件全文做一次性正则扫描。
 * 这样不依赖 vue-eslint-parser 的 visitorKeys，统一覆盖 .vue / .ts / .tsx / .css 全部文件。
 *
 * 白名单：transparent、none、currentColor、inherit、纯数字通道字符串；hex/rgb/hsl
 * 扫描跳过 var(...) 区间（style 内 var 引用与回退色合法）。例外：Tailwind 任意值
 * 类写法 *-[var(--color-*)] 不在豁免内，经 noArbitraryToken 独立报出。
 *
 * Why 全文扫描而非 AST 节点：颜色值出现的位置跨越 JS 字符串、模板属性、<style> 块、
 * 模板内联 style 与 CSS 文件，没有任何单一 AST 节点类型能覆盖；全文扫描 + var(...) 区间
 * 跳过是复杂度最低的完备方案。代价是注释中的颜色样例也会被报——模板/文档文件里的示例
 * 色值要么豁免文件，要么接受报错（本规则的设计意图就是"颜色出现即治理"）。
 */

const COLOR_REGEX =
  /(?<![\w#&])#([0-9A-Fa-f]{8}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{4}|[0-9A-Fa-f]{3})\b|\brgba?\([^)]+\)|\bhsla?\([^)]+\)/gi

/**
 * Tailwind 任意值引用设计 token 的写法，如 text-[var(--color-text-secondary)]。
 * var(...) 豁免只针对 hex/rgb/hsl 扫描；任意值类写法绕过 @theme 注册的同名
 * 工具类，主题换肤/重构时无法被工具链追踪，须独立报出（noArbitraryToken）。
 * token 变量前缀（此处 --color-）按项目 design token 命名约定调整。
 */
const ARBITRARY_TOKEN_REGEX = /[\w-]+-\[var\(--color-[\w-]+\)\]/g

const WHITELIST_EXACT = new Set(['transparent', 'none', 'currentcolor', 'inherit', 'currentColor'])

/** 纯数字通道字符串，如 BorderGlow 默认 glowColor: '40 80 80' */
function isDigitChannels(value) {
  return /^\s*\d+(?:\s+\d+)*\s*$/.test(value)
}

/** 提取 value 中所有 var(...) 区间 */
function getVarRanges(value) {
  const ranges = []
  const re = /var\s*\([^)]*\)/gi
  let match
  while ((match = re.exec(value)) !== null) {
    ranges.push([match.index, match.index + match[0].length])
  }
  return ranges
}

/** 在 value 中查找硬编码颜色，跳过 var(...) 区间及包装它的颜色函数 */
function findHardcodedColors(value) {
  if (typeof value !== 'string') return []
  const trimmed = value.trim()
  if (WHITELIST_EXACT.has(trimmed)) return []
  if (isDigitChannels(value)) return []

  const varRanges = getVarRanges(value)
  const matches = []
  let match
  COLOR_REGEX.lastIndex = 0
  while ((match = COLOR_REGEX.exec(value)) !== null) {
    const start = match.index
    const end = start + match[0].length
    // 与 var(...) 区间有交集即跳过：除 var(--x, #fallback) 回退色（匹配被区间包含）外，
    // rgb(var(--x)) 变量通道包装形态的颜色匹配会反向覆盖 var 区间——被包含判断会漏放
    const touchesVar = varRanges.some(([s, e]) => start < e && end > s)
    if (!touchesVar) {
      matches.push(match[0])
    }
  }
  return matches
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description: '禁止硬编码颜色值，要求使用设计 Token 或 CSS 变量',
    },
    schema: [
      {
        type: 'object',
        properties: {
          // 颜色 → 项目设计 Token 建议，key 为小写 hex（如 '#ff8400'）或完整函数字符串
          suggestions: {
            type: 'object',
            additionalProperties: { type: 'string' },
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      noHardcodedColor: '硬编码颜色值 "{{color}}" 不允许。请使用 {{suggestion}}。',
      noArbitraryToken:
        '任意值写法 "{{token}}" 绕过了 @theme 注册的同名工具类。请直接使用设计 Token 工具类（如 text-text-secondary / bg-surface-card）。',
    },
  },
  create(context) {
    const { suggestions = {} } = context.options[0] ?? {}
    const sourceCode = context.sourceCode

    function getSuggestion(color) {
      return (
        suggestions[color.toLowerCase()] ||
        '设计 Token 或 CSS 变量 var(--color-*)'
      )
    }

    return {
      Program() {
        const text = sourceCode.getText()
        const colors = findHardcodedColors(text)
        let searchFrom = 0
        for (const color of colors) {
          const index = text.indexOf(color, searchFrom)
          if (index === -1) continue
          searchFrom = index + color.length
          const start = sourceCode.getLocFromIndex(index)
          const end = sourceCode.getLocFromIndex(index + color.length)
          context.report({
            loc: { start, end },
            messageId: 'noHardcodedColor',
            data: { color, suggestion: getSuggestion(color) },
          })
        }

        // 任意值 token 引用独立报出（不走 var 区间豁免）
        ARBITRARY_TOKEN_REGEX.lastIndex = 0
        let arbitrary
        while ((arbitrary = ARBITRARY_TOKEN_REGEX.exec(text)) !== null) {
          const start = sourceCode.getLocFromIndex(arbitrary.index)
          const end = sourceCode.getLocFromIndex(arbitrary.index + arbitrary[0].length)
          context.report({
            loc: { start, end },
            messageId: 'noArbitraryToken',
            data: { token: arbitrary[0] },
          })
        }
      },
    }
  },
}
