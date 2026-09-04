/**
 * ESLint 规则：禁止注释夹带开发追踪标记与外部编号引用（模板）
 *
 * 项目化调整点（复制到 <repo-root>/eslint-plugin-<org>/rules/no-tracking-marker.js 后评估）：
 * ① PATTERNS 形态集与 kind 文案按项目任务系统的编号惯例裁剪（默认覆盖 Phase/任务 ID/切片 ID/规格章节引用等 15 类）
 * ② 豁免与追加形态经 flat config options 注入（allow / additionalPatterns），不改规则本体
 * ③ 排除边界（eslint/@ts- 指令注释）为通用设计，一般无需调整
 *
 * ────────────────────────────────────────────────────────────────
 *
 * 追踪编号（任务系统的任务 ID、规划文档的阶段号、评审发现编号）在注释里无法溯源——
 * 任务系统废弃或规划文档删除后，编号成为死引用，读者既不知道它指什么，也无法验证是否仍然成立。
 * 注释应只解释 why（隐含假设、折衷、不稳健之处），需要溯源时用自己的话重述背景。
 *
 * 实现策略：逐注释扫描（getAllComments + .vue 模板 HTMLComment + .vue <style> 块 CSS 注释
 * ——style 非 JS 代码不进 parser AST，只能对源文本切区间提取），report 定位到注释节点。
 * 只扫注释不扫字符串与代码——日期、版本号、文案里的数字形态天然免疫。
 *
 * 检测形态与排除边界：
 * - 命中：Phase/Plan 编号、字母-数字对任务 ID（T-04-03/D-13）、无连字符单字母 ID（D11/S3/P1-a）、
 *   纯数字对（17-02——与行号引用形态同构，命中走 numericRange 专属报错，指引改写为 L 前缀
 *   permalink 形式如 L56-L126，该形式规则天然免疫）、中文关键词+字母编号（阶段 U1/决策 D2）、
 *   中文阶段编号（"阶段 1 — 认证"/"知识库阶段 8"）、
 *   英文步骤/分段标签（"Step 1:"/"Stage 2"/"Part A:"/"Part B2:"）——中英文阶段语义同族：编号是规划文档在函数内的
 *   残留，脱离文档即死引用，函数内代码重排后编号语义随之漂移，一律禁止；
 *   CR#/ADR 外部编号、spec/§ 规格章节引用（"spec §4.4"/"spec(§4.4)"/"spec 4.4"/裸 "§2.3"——
 *   设计稿/规格文档章节号在注释里无法溯源）、审查溯源措辞（正交审查/审查发现）、flow/teammate 上下文编号、DEFAULT- 前缀、
 *   内部系统路由代号（Route Z——线上系统的内部路由编号，仓库内无任何对应物可溯源）
 * - 排除：eslint/@ts- 指令注释——否则 disable 本规则的注释会自我举报，永远无法抑制
 *
 * 已知盲点（unsound，需逃逸时用 allow 选项）：
 * - numeric-pair 会被时间区间误伤（"02:00-04:00" 中的 "00-04"）
 * - bare-id 字母集 [DPTSU] 与实体名冲突（AWS S3、百分位 P95、Google T5）
 * - 长字母前缀编号（如 XXXXXX-01）仅 DEFAULT- 有独立模式
 * - 阶段\s*\d+ 会把"阶段 N 次/天"类数量表述误伤（罕见，锚定 allow 逃逸）
 * - 阶段语义族大小写不敏感，普通英文表述（"part a of ..."/"plan 9"/"step 2 再试"）与
 *   "Part B2" 类部件号引用同属检出范围，唯一豁免通道是 allow；
 *   "Part B2X" 数字后跟字母时 \b 无法落在词内，仍免疫
 * - spec 族不要求 § 符号（"spec 4.4" 命中），协议版本表述（"OpenAPI spec 3.0"）会被误伤，
 *   经 allow 豁免；无编号的 spec 一词不命中
 *
 * 使用注意：
 * - allow 为部分匹配（RegExp.test），精确豁免单个 marker 请写锚定形式，如 '^S3$'
 * - allow / additionalPatterns 的正则非法时在 create() 抛错并注明出处，属配置级错误
 * - 本文件为 .js 时若项目 lint 范围只含 ts/tsx/vue，头注释的形态示例不会自举报错；
 *   若 lint 范围含 js，需先删除或改写头注释示例
 */

/** 内置检测模式集；kind 用于报错信息说明命中类别 */
const PATTERNS = [
  // 阶段语义族（Phase/Plan/Step/Stage/Part）大小写不敏感：语义不因大小写改变性质，唯一豁免通道是 allow
  { kind: '阶段/计划编号', re: /\b(?:Phase|Plan)\s*\d+/i },
  { kind: '任务编号', re: /\b[A-Z]{1,3}-\d{2}(?:-\d{2})?\b/ },
  // 后随 ASCII 字母的是量词区间（15-18px），不是编号；CJK/标点/空白结尾仍命中。
  // 数字区间与行号引用形态同构（56-126），命中走 numericRange 专属报错，
  // 指引改写为 L 前缀 permalink 形式（L56-L126）——该形式规则天然免疫
  { kind: '迭代编号', re: /(?<![\d-])\d{2}-\d{2}(?![\dA-Za-z-])/, messageId: 'numericRange' },
  { kind: '规划残留前缀', re: /\bDEFAULT-\d+\b/ },
  // 字母集刻意收窄：B/F/M 与实体名（Mac M3、Part B2）冲突面大，仅由上下文模式覆盖
  { kind: '任务编号', re: /(?<![\w-])[DPTSU]\d{1,2}(?:-[a-z])?\b/ },
  { kind: '阶段/决策编号', re: /(?:阶段|决策)\s*[A-Z]+\d+\b/ },
  // 中文"阶段 N"是规划文档阶段号在函数内的残留形态，脱离文档即死引用
  { kind: '阶段编号', re: /阶段\s*\d+/ },
  // 英文步骤/分段标签与中文阶段编号同族：阶段语义编号脱离规划文档即死引用，一律禁止
  { kind: '步骤编号', re: /\b(?:Step|Stage)\s+\d+\b/i },
  { kind: '分段编号', re: /\bPart\s+[A-Z]\d*\b/i },
  { kind: '外部编号', re: /CR#\d+\b|\bADR-?\d+\b/ },
  // spec/§ 规格章节引用："spec §4.4"/"spec(§4.4)"/"spec 4.4"/裸 "§2.3"——设计稿/规格文档的
  // 章节号在注释里无法溯源；§ 符号本身即章节引用信号，有无 spec 前缀均命中（两条模式长短互补，
  // 含 spec 的命中更长，去重逻辑保留长者）
  { kind: '规格引用', re: /\bspecs?\b\s*[(：:]?\s*(?:§\s*)?\d+(?:\.\d+)*/i },
  { kind: '章节引用', re: /§\s*\d+(?:\.\d+)*/ },
  { kind: '审查溯源', re: /正交审查|审查发现/ },
  { kind: '协作编号', re: /(?:flow|teammate\s+review)\s+[A-Z]\d+\b/i },
  // 大写敏感与 Phase 同理：小写 route 是 HTTP 路由的普通技术词，大写单字母形态才指向内部系统代号
  { kind: '路由代号', re: /\bRoute\s+[A-Z]\b/ },
]

/** eslint/@ts- 指令注释前缀——跳过不扫，避免 disable 注释自我举报 */
const DIRECTIVE_RE = /^\s*(eslint[-\s]|globals?[\s:]|@ts-(?:ignore|nocheck|expect-error))/

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        '禁止注释夹带开发追踪标记与外部编号引用（编号无法从代码溯源，应用自己的话重述 why）',
    },
    schema: [
      {
        type: 'object',
        properties: {
          allow: { type: 'array', items: { type: 'string' } },
          additionalPatterns: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      trackingMarker:
        '注释夹带开发追踪标记 "{{marker}}"（{{kind}}）。编号无法从代码溯源——请删除，或用自己的话重述 why。',
      numericRange:
        '注释夹带数字区间 "{{marker}}"。若意在标记行号，请改写为 {{suggestion}}（L 前缀，GitHub permalink 风格）——裸数字对与迭代编号无法区分，一律按追踪标记拦截；否则请删除，或用自己的话重述 why。',
    },
  },
  create(context) {
    const options = context.options[0] ?? {}
    // 非法正则属配置级错误：抛错时注明选项名与原文，否则维护者只能拿到无出处的 SyntaxError 堆栈
    const compile = (src, optName) => {
      try {
        return new RegExp(src)
      } catch (err) {
        throw new Error(
          `no-tracking-marker: 选项 ${optName} 含非法正则 ${JSON.stringify(src)}（${err.message}）`,
          { cause: err }
        )
      }
    }
    const allowRes = (options.allow ?? []).map((src) => compile(src, 'allow'))
    const extraPatterns = (options.additionalPatterns ?? []).map((src) => ({
      kind: '自定义标记',
      re: compile(src, 'additionalPatterns'),
    }))
    const patterns = [...PATTERNS, ...extraPatterns].map(({ kind, re, messageId }) => ({
      kind,
      messageId,
      // 同注释同模式的多次命中须全部上报，matchAll 依赖 g flag，统一预编译为全局形态
      scanRe: new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'),
    }))

    /** 单条注释的违规扫描：收集全部未被 allow 豁免的匹配；
     *  被更长匹配包含的视为重复；区间完全相同时保留数组序靠前者（内置模式在前，kind 描述更准确） */
    function scanComment(comment) {
      const value = comment.value
      if (DIRECTIVE_RE.test(value)) return
      const hits = []
      for (const { kind, messageId, scanRe } of patterns) {
        for (const match of value.matchAll(scanRe)) {
          if (allowRes.some((allow) => allow.test(match[0]))) continue
          hits.push({
            kind,
            messageId,
            marker: match[0],
            start: match.index,
            end: match.index + match[0].length,
          })
        }
      }
      for (const [i, hit] of hits.entries()) {
        const contained = hits.some(
          (other, j) =>
            j !== i &&
            other.start <= hit.start &&
            other.end >= hit.end &&
            (other.start < hit.start || other.end > hit.end || j < i)
        )
        if (contained) continue
        // numericRange 的 suggestion 给出 L 前缀行号改写形式（去前导零：17-02 → L17-L2）
        const suggestion =
          hit.messageId === 'numericRange'
            ? hit.marker.replace(/(\d+)-(\d+)/, (_, a, b) => `L${+a}-L${+b}`)
            : undefined
        context.report({
          node: comment,
          messageId: hit.messageId ?? 'trackingMarker',
          data: { marker: hit.marker, kind: hit.kind, suggestion },
        })
      }
    }

    return {
      'Program:exit'() {
        const { ast } = context.sourceCode
        for (const comment of context.sourceCode.getAllComments()) {
          scanComment(comment)
        }
        // .vue 模板的 HTML 注释不在 getAllComments 中，挂在 templateBody.comments
        for (const comment of ast.templateBody?.comments ?? []) {
          scanComment(comment)
        }
        // <style> 块的 CSS 注释同样不进 parser AST（style 非 JS 代码），只能对源文本
        // 按 <style> 区间切出 /* */ 注释再扫；伪节点自带 range/loc 供 report 定位
        if (context.filename.endsWith('.vue')) {
          const text = context.sourceCode.getText()
          for (const block of text.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)) {
            const base = block.index + block[0].indexOf(block[1])
            for (const m of block[1].matchAll(/\/\*[\s\S]*?\*\//g)) {
              const start = base + m.index
              const end = start + m[0].length
              scanComment({
                type: 'Block',
                value: m[0].slice(2, -2),
                range: [start, end],
                loc: {
                  start: context.sourceCode.getLocFromIndex(start),
                  end: context.sourceCode.getLocFromIndex(end),
                },
              })
            }
          }
        }
      },
    }
  },
}
