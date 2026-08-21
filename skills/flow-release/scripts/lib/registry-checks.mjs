/**
 * npm registry 类检查（异步收集式）：npm view / npm org ls / 首发元数据审计。
 *
 * Why 独立模块：主文件检查是同步 report 风格（本地命令毫秒级），registry 检查
 * 走"收集 → Promise.all 并行 → 按包序 flatten"的异步风格——两种风格混在一处
 * 互相干扰，按风格分文件各归其位。并发缓存（scopeVerdicts 存 Promise）随工厂
 * 实例化，一次 preflight 运行内有效。
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'

export function createRegistryChecks({ cwd, run, runAsync, report }) {
  const NPM_REGISTRY = 'https://registry.npmjs.org'

  /**
   * registry / 首发判定，按发布目标分流（异步收集版）。
   * - vscode-extension：不上 npm registry，首发判定改用 git tag 历史（无 v* tag = 首发）
   * - npm-package / cli：npm view 查询，404 = 首发；显式锁官方源避免镜像同步延迟假阴性
   * Why 收集式：返回检查结果数组而不直接 report，供主流程 Promise.all 并行后按包序
   * flatten——既拿到并行提速，输出顺序仍稳定按包序，不随网络完成先后跳动。
   * 返回 { name, checks, firstPublish }：firstPublish 供首发元数据审计聚合使用。
   */
  async function collectRegistry(pkg, target, label = '') {
    const checks = []
    const push = (name, status, detail = '') => checks.push({ name, status, detail })
    const suffix = label ? ` (${label})` : ''
    const done = (firstPublish = false) => ({ name: pkg.name, checks, firstPublish })
    if (pkg.private) {
      // monorepo 遍历时 private 包静默跳过，避免噪音；单包模式保留提示
      if (!label) push('npm registry', 'info', 'private 包，跳过')
      return done()
    }
    if (target === 'claude-skill') {
      push(`npm registry${suffix}`, 'info', `${pkg.name} 为 skill 包（SKILL.md），不通过 npm registry 分发，跳过`)
      return done()
    }
    if (target === 'cc-plugin') {
      push(`npm registry${suffix}`, 'info', `${pkg.name} 为 Claude Code 插件，经 marketplace（git clone）分发，跳过 npm registry 检查`)
      return done()
    }
    if (target === 'skill-monorepo') {
      push(`npm registry${suffix}`, 'info', `${pkg.name} 为 skill monorepo（逐技能独立版本，npx skills 分发），跳过 npm registry 检查`)
      return done()
    }
    if (target === 'vscode-extension') {
      const tag = run(`git tag -l 'v*' --sort=-v:refname | head -1`)
      if (!tag.ok || !tag.out) {
        push(`首发判定${suffix}`, 'info', 'VSCode 扩展（vsce），无 v* tag = 首发')
        return done(true)
      }
      push(`首发判定${suffix}`, 'info', `VSCode 扩展（vsce），最新 tag = ${tag.out}`)
      return done()
    }
    const r = await runAsync(`npm view ${pkg.name} version --registry ${NPM_REGISTRY}`, 15_000)
    if (r.ok && r.out) {
      push(`npm registry${suffix}`, 'info', `${pkg.name} 已发布，latest = ${r.out}`)
      return done()
    }
    if (/E404|404/.test(r.err)) {
      push(`npm registry${suffix}`, 'info', `${pkg.name} 查无此包（404）= npm 首发，走「6. 首次发布检测」`)
      const scope = pkg.name.match(/^@([^/]+)\//)?.[1]
      if (scope) {
        const verdict = await checkScopeVerdict(scope)
        push(`npm scope${suffix}`, verdict.status, verdict.detail)
      }
      return done(true)
    }
    push(`npm registry${suffix}`, 'warn', `${pkg.name} 查询失败（网络/认证），无法判定首发状态: ${r.err.slice(0, 120)}`)
    return done()
  }

  /**
   * scoped 包首发的 scope（npm 组织）成立性检查——首发（npm view 404）时触发。
   * Why: npm 读路径（view/search）对"org 不存在"与"org 存在但无包"返回相同的
   * 404 Not found，只有写路径（PUT publish）才区分——E404 "Scope not found" 要到
   * publish 时才爆出，此时 release commit/tag 已落地，修复成本翻倍。`npm org ls`
   * 走 registry 的 /-/org/<scope>/user 端点，与 publish 的判定同源，是读路径下
   * 唯一的区分通道；npm 数据模型里个人账号等价于一人的 org（npm org ls <username>
   * 返回 owner），故个人 scope（@<username>/*）同样适用，无需 whoami 特判。
   * 并发缓存：value 是 Promise 而非结果——并行场景下同 scope 多包同时到达时
   * 复用同一个在途查询，只发一次请求。
   */
  const scopeVerdicts = new Map()
  function checkScopeVerdict(scope) {
    let p = scopeVerdicts.get(scope)
    if (!p) {
      p = (async () => {
        const r = await runAsync(`npm org ls ${scope} --registry ${NPM_REGISTRY}`, 15_000)
        if (r.ok) {
          return { status: 'pass', detail: `@${scope} 组织/个人 scope 存在` }
        }
        if (/Scope not found|E404|404/.test(r.err)) {
          return {
            status: 'fail',
            detail:
              `@${scope} 组织不存在（Scope not found）——scoped 包首发要求 scope 对应已存在的 npm 组织，` +
              `请到 https://www.npmjs.com/org/create 创建同名组织（Free 计划即可发 public 包），否则 publish 将 E404`,
          }
        }
        return { status: 'warn', detail: `@${scope} 组织存在性查询失败（网络/认证），无法判定: ${r.err.slice(0, 120)}` }
      })()
      scopeVerdicts.set(scope, p)
    }
    return p
  }

  /**
   * 首发元数据审计：对被判定 npm 首发（404）的包聚合检查 package.json 字段与包级
   * README/LICENSE，缺项一次输出。Why: 首发字段审计历史上靠 agent 逐包多轮 bash
   * 检查（author → repository → keywords → README，每个一轮），把它机械化可以省掉
   * 整个往返；且 license 主动留空 / README 由 npm 自动占位生成这类"合法但值得提醒"
   * 的状态，warn 级提示每次发版都会重新浮现，正好充当待办。
   */
  function checkFirstPublishMetadata(packages, firstPublishNames) {
    const targets = packages.filter(({ pkg }) => firstPublishNames.has(pkg.name))
    if (!targets.length) return
    const missing = []
    for (const { pkg, dir } of targets) {
      const gaps = []
      if (!pkg.author) gaps.push('author')
      if (!pkg.repository) gaps.push('repository')
      if (!Array.isArray(pkg.keywords) || pkg.keywords.length === 0) gaps.push('keywords')
      if (!pkg.license && !existsSync(join(dir, 'LICENSE'))) gaps.push('license')
      if (!['README.md', 'readme.md', 'README.markdown', 'README'].some((f) => existsSync(join(dir, f)))) gaps.push('README(npm 将自动占位)')
      if (gaps.length) missing.push(`${pkg.name} 缺 ${gaps.join('/')}`)
    }
    if (missing.length) {
      report('首发元数据', 'warn', `${missing.join('；')}`)
    } else {
      report('首发元数据', 'pass', `${targets.length} 个首发包字段齐全`)
    }
  }

  /** 发布后 registry 校验（异步收集版）：返回检查结果数组，主流程 Promise.all 并行后按包序 flatten */
  async function collectPostRegistry(pkg, target, label = '') {
    const checks = []
    const push = (name, status, detail = '') => checks.push({ name, status, detail })
    const suffix = label ? ` (${label})` : ''
    if (pkg.private) return checks
    if (target === 'claude-skill') {
      push(`registry 版本${suffix}`, 'pass', `${pkg.name} 为 skill 包，不校验 npm registry，推送到 GitHub 即完成分发`)
      return checks
    }
    if (target === 'cc-plugin') {
      push(`registry 版本${suffix}`, 'pass', `${pkg.name} 为 Claude Code 插件，不校验 npm registry；tag 与 marketplace 推送即完成分发`)
      return checks
    }
    if (target === 'vscode-extension') {
      // VSCode 扩展不上 npm，--post 改校验 vsix 产物（vsce package 生成 <name>-<version>.vsix）
      const vsix = `${pkg.name}-${pkg.version}.vsix`
      if (existsSync(join(cwd, vsix))) {
        push(`vsix 产物${suffix}`, 'pass', `${vsix} 已生成`)
      } else {
        push(`vsix 产物${suffix}`, 'fail', `${vsix} 未找到，确认已跑 pnpm release / vsce package`)
      }
      return checks
    }
    // 同包三个 registry 查询（版本/dist-tags/dependencies）也并行，单包耗时从 3 往返降为 1
    const [v, tags, deps] = await Promise.all([
      runAsync(`npm view ${pkg.name}@${pkg.version} version --registry ${NPM_REGISTRY}`, 15_000),
      runAsync(`npm view ${pkg.name} dist-tags --json --registry ${NPM_REGISTRY}`, 15_000),
      runAsync(`npm view ${pkg.name}@${pkg.version} dependencies --json --registry ${NPM_REGISTRY}`, 15_000),
    ])
    if (v.ok && v.out === pkg.version) {
      push(`registry 版本${suffix}`, 'pass', `${pkg.name}@${pkg.version} 可查`)
    } else {
      push(`registry 版本${suffix}`, 'fail', `官方源查不到 ${pkg.name}@${pkg.version}（刚发布可能有秒级延迟，稍后重试）`)
    }

    if (tags.ok && tags.out) {
      push(`dist-tags${suffix}`, 'info', tags.out.replace(/\s+/g, ' ').trim())
    }

    // workspace:* 残留会让安装方直接失败，必须拦截
    if (deps.ok && /workspace:/.test(deps.out)) {
      push(`workspace 协议${suffix}`, 'fail', '已发布包的 dependencies 仍含 workspace:*，应使用 pnpm publish')
    } else if (deps.ok) {
      push(`workspace 协议${suffix}`, 'pass', 'dependencies 无 workspace:* 残留')
    }
    return checks
  }

  return { collectRegistry, collectPostRegistry, checkFirstPublishMetadata }
}
