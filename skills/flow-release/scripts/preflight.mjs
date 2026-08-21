#!/usr/bin/env node

/**
 * flow-release 技能的发版机械检查（preflight / postflight）
 *
 * Why: 发版检查清单中可机械判定的项（工作区、远程同步、CHANGELOG 结构、
 * release 脚本链、registry 状态、tag 冲突）交给脚本一次跑完——比 agent 逐条
 * 执行 git/npm 命令快一个数量级，且不消耗上下文 token。agent 只需处理 fail 项，
 * info 项（分支/tag/registry 状态）直接作为分支模型判定（技能第 1.1 步）的输入。
 *
 * 用法:
 *   node preflight.mjs            发版前检查（默认）
 *   node preflight.mjs --post     发布后校验
 *   node preflight.mjs --json     JSON 输出（供自动化流程消费）
 *   node preflight.mjs --cwd DIR  指定项目目录（默认当前目录）
 *
 * 退出码: 存在 fail 项时为 1，否则为 0（warn / info 不阻断）。
 */

import { exec, execSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { createCcPluginChecks } from './lib/cc-plugin.mjs'
import { createRegistryChecks } from './lib/registry-checks.mjs'
import { createSkillMonorepoChecks } from './lib/skill-monorepo.mjs'

const execP = promisify(exec)

const argv = process.argv.slice(2)
const isPost = argv.includes('--post')
const asJson = argv.includes('--json')
const cwdFlag = argv.indexOf('--cwd')
const cwd = cwdFlag !== -1 ? argv[cwdFlag + 1] : process.cwd()

const NPM_REGISTRY = 'https://registry.npmjs.org'
const results = []

/** registry URL 归一化：去尾部斜杠、http 升 https，使不同写法的同源地址可比较 */
function normalizeRegistry(url) {
  if (!url) return null
  return url.trim().replace(/\/+$/, '').replace(/^http:/, 'https:')
}
function isOfficialRegistry(url) {
  return normalizeRegistry(url) === NPM_REGISTRY
}

function report(name, status, detail = '') {
  results.push({ name, status, detail })
}

/**
 * 执行 shell 命令并捕获结果。发版检查里命令失败本身就是信号（如 npm view 404
 * 表示首发），所以失败不抛出，由调用方根据 ok / err 判读。
 * Why err 组装：execSync 被 timeout 杀死（SIGTERM）时 e.stderr 为空串，若直接
 * String(e.stderr) 会吞掉所有信息——回落 e.message（含 command 与 signal），
 * 调用方至少能区分"命令报错"与"超时被杀"。
 */
function run(cmd, timeout = 10_000) {
  try {
    const out = execSync(cmd, {
      cwd,
      encoding: 'utf8',
      timeout,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
    return { ok: true, out, err: '' }
  } catch (e) {
    const stderr = e.stderr != null ? String(e.stderr).trim() : ''
    return { ok: false, out: '', err: stderr || String(e.message ?? e) }
  }
}

/**
 * run 的异步版，供网络类检查（npm view / npm org ls / git ls-remote）并行执行。
 * Why: monorepo 逐包串行查询 registry 时每包一次网络往返（1-3s），13 包即 40s，
 * preflight 在一次发版中通常跑 2-3 遍（初检/修复后复检），串行是纯浪费；
 * 并行后总耗时 ≈ 最慢单包，网络挂起时也从 N×超时 降为 1×超时。
 * 本地命令（git status 等毫秒级）仍用同步 run，不付异步编排成本。
 */
async function runAsync(cmd, timeout = 10_000) {
  try {
    const { stdout } = await execP(cmd, { cwd, encoding: 'utf8', timeout })
    return { ok: true, out: stdout.trim(), err: '' }
  } catch (e) {
    const stderr = e.stderr != null ? String(e.stderr).trim() : ''
    return { ok: false, out: '', err: stderr || String(e.message ?? e) }
  }
}

// 发布目标形态检查模块：异步收集式（registry）与三个非 npm 形态各归其位，
// 依赖（cwd / run / runAsync / report）工厂注入，模块间不互相 import
const { collectRegistry, collectPostRegistry, checkFirstPublishMetadata } = createRegistryChecks({ cwd, run, runAsync, report })
const { detectSkillMonorepo, checkSkillMonorepo, collectPostSkillMonorepo } = createSkillMonorepoChecks({ cwd, run, runAsync, report })
const { findPluginManifest, checkCcPluginVersionSync } = createCcPluginChecks({ cwd, report })

// ─── 发版前检查 ──────────────────────────────────────────────

function checkGitRepo() {
  const r = run('git rev-parse --is-inside-work-tree')
  if (!r.ok || r.out !== 'true') {
    report('git 仓库', 'fail', '当前目录不是 git 仓库，后续检查终止')
    return false
  }
  return true
}

function checkWorktree() {
  const r = run('git status --porcelain')
  if (r.ok && !r.out) {
    report('工作区', 'pass', '干净，无未提交变更')
  } else {
    report('工作区', 'fail', `存在未提交变更:\n${r.out || r.err}`)
  }
}

function checkBranchSync() {
  const branch = run('git branch --show-current')
  if (!branch.ok || !branch.out) {
    report('当前分支', 'fail', 'detached HEAD，不在任何分支上')
    return
  }
  report('当前分支', 'info', branch.out)

  // fetch 失败（离线/无远程）不阻断，降级后基于本地 upstream 引用判断
  const fetched = run('git fetch origin --quiet', 20_000).ok
  const upstream = run('git rev-parse --abbrev-ref @{u}')
  if (!upstream.ok || !upstream.out) {
    report('远程同步', 'warn', `${branch.out} 无 upstream（未推送或无远程分支）`)
    return
  }
  const ahead = Number(run(`git rev-list --count @{u}..HEAD`).out || 0)
  const behind = Number(run(`git rev-list --count HEAD..@{u}`).out || 0)
  if (ahead > 0) {
    // 未推送提交随发版末尾统一推送（技能 1.4 / 第 5 步），是常态路径而非异常——
    // 若判 fail，每次发版开局必现一条无需处理的阻断项，会训练操作者无视 fail
    report('远程同步', 'info', `领先 ${upstream.out} ${ahead} 个提交，将随发版推送`)
  } else if (behind > 0) {
    report('远程同步', 'warn', `落后 ${upstream.out} ${behind} 个提交，先 git pull --ff-only`)
  } else {
    report('远程同步', 'pass', `与 ${upstream.out} 一致${fetched ? '' : '（fetch 失败，基于本地引用）'}`)
  }
}

/** 长期分支与最新 tag 位置探测，输出为分支模型判定（技能第 1.1 步）的直接输入 */
function probeBranchModel(tagPatterns = ['v*'], tagSort = '-v:refname') {
  const patterns = Array.isArray(tagPatterns) ? tagPatterns : [tagPatterns]
  const branches = run(`git branch -a --list '*release*' '*develop*' 'test'`)
  const branchList = branches.ok && branches.out ? branches.out.replace(/\s+/g, ' ').trim() : ''
  report('长期分支', 'info', branchList || '无 release / develop / test 分支')

  const tag = run(`git tag -l ${patterns.map((p) => `'${p}'`).join(' ')} --sort=${tagSort} | head -1`)
  if (!tag.ok || !tag.out) {
    report('最新 tag', 'info', `无 ${patterns.join(' ')} 标签（疑似首发）`)
    return
  }
  const containers = run(`git branch --contains ${tag.out}`)
  const where = containers.ok && containers.out ? containers.out.replace(/\s+/g, ' ').trim() : '（不在任何本地分支）'
  report('最新 tag', 'info', `${tag.out} 位于: ${where}`)
}

/**
 * 解析 CHANGELOG 已发布版本段：支持可选包名前缀（monorepo 逐包段，如
 * `[@scope/pkg 1.2.3] - 2024-01-01`）。文件约定新版本在前，故逐包首次出现即最新。
 * 返回 { first, latestByPackage }：first 供日期校验，latestByPackage 供逐包版本比对。
 */
function parseChangelogSections(content) {
  const latestByPackage = new Map()
  let first = null
  const re = /^## \[(?:(@?[\w./-]+) )?(\d+\.\d+\.\d+[^\s\]]*)\] - (\S+)/gm
  let m
  while ((m = re.exec(content))) {
    const [, pkgName = null, version, date] = m
    if (!first) first = { pkgName, version, date }
    if (!latestByPackage.has(pkgName)) latestByPackage.set(pkgName, version)
  }
  return { first, latestByPackage }
}

/** 返回 CHANGELOG 版本段解析结果（无已发布段时 first 为 null） */
function checkChangelog() {
  const file = join(cwd, 'CHANGELOG.md')
  if (!existsSync(file)) {
    report('CHANGELOG', 'fail', 'CHANGELOG.md 不存在')
    return { first: null, latestByPackage: new Map() }
  }
  const content = readFileSync(file, 'utf8')
  if (/^## \[Unreleased\]/m.test(content)) {
    report('CHANGELOG [Unreleased]', 'pass', '区块存在')
  } else {
    report('CHANGELOG [Unreleased]', 'fail', '缺少 ## [Unreleased] 区块')
  }

  const parsed = parseChangelogSections(content)
  if (!parsed.first) {
    report('CHANGELOG 版本段', 'info', '尚无已发布版本段（首发）')
    return parsed
  }
  const { pkgName, version, date } = parsed.first
  const label = pkgName ? `${pkgName} ${version}` : version
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    report('CHANGELOG 日期', 'pass', `[${label}] - ${date}`)
  } else {
    report('CHANGELOG 日期', 'fail', `[${label}] 的日期 "${date}" 非 ISO 8601（YYYY-MM-DD）`)
  }
  return parsed
}

function readPackage() {
  const file = join(cwd, 'package.json')
  if (!existsSync(file)) {
    report('package.json', 'info', '不存在（非 Node 项目），跳过包相关检查')
    return null
  }
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    report('package.json', 'fail', 'JSON 解析失败')
    return null
  }
}

function checkReleaseScripts(pkg, target) {
  if (target === 'claude-skill') {
    report('release 脚本', 'pass', 'skill 包（SKILL.md）不通过 npm 发布，无需 release 脚本')
    return
  }
  const s = pkg.scripts ?? {}
  if (target === 'cc-plugin') {
    // CC 插件不经 npm publish，release 脚本只承担门禁链角色；缺失降级 warn，存在则继续校验钩子链
    if (s.release) {
      report('release 脚本', 'pass', s.release)
    } else {
      report('release 脚本', 'warn', '缺失（CC 插件无需 npm publish，但建议以 release 脚本收敛门禁链）')
    }
  } else if (s.release) {
    report('release 脚本', 'pass', s.release)
  } else {
    report('release 脚本', 'fail', '缺少 scripts.release（约定见技能「发布脚本约定」）')
  }
  // 钩子链缺失为 warn 而非 fail——老项目可能尚未补齐约定，不阻断发版
  if (!s.prerelease) {
    report('prerelease → build', 'warn', '缺失（约定：prerelease 自动 build）')
  } else if (/build/.test(s.prerelease)) {
    report('prerelease → build', 'pass', s.prerelease)
  } else {
    report('prerelease → build', 'warn', `prerelease 未含 build: ${s.prerelease}`)
  }
  // 测试门禁的实际挂载点是 build 目标对应的 pre 钩子；build 目标以 prerelease
  // 实际调用为准（多包项目常为 build:packages）——只查字面 prebuild 会误报缺失
  const buildTarget = s.prerelease?.match(/build(?::[\w-]+)?/)?.[0] ?? 'build'
  const preHookName = `pre${buildTarget}`
  const preHook = s[preHookName]
  if (!preHook) {
    report(`${preHookName} → test`, 'warn', `缺失（约定：${preHookName} 自动 test）`)
  } else if (/test/.test(preHook)) {
    report(`${preHookName} → test`, 'pass', preHook)
  } else {
    report(`${preHookName} → test`, 'warn', `${preHookName} 未含 test: ${preHook}`)
  }
}

function checkVersionConsistency(pkg, changelogInfo, target, packages = [], isMonorepo = false) {
  if (isMonorepo) {
    // monorepo 根包通常 private/0.0.0，其 version 与 v<根版本> tag 都无发版语义——
    // 版本比对与重复发版守卫必须逐可发布包进行（tag 形态为 <name>@<version>）
    const { latestByPackage } = changelogInfo
    for (const { pkg: sub } of packages) {
      if (sub.private || !sub.name || !sub.version) continue
      const changelogVersion = latestByPackage.get(sub.name)
      if (changelogVersion && changelogVersion !== sub.version) {
        report(
          '版本一致性',
          'warn',
          `${sub.name}: package.json (${sub.version}) 与 CHANGELOG 最新段 (${changelogVersion}) 不一致；若处于版本号升级前属正常`,
        )
      } else if (changelogVersion) {
        report('版本一致性', 'pass', `${sub.name}@${sub.version}`)
      }
      const tag = `${sub.name}@${sub.version}`
      const occupied = run(`git tag -l '${tag}'`).out === tag
      // 占用不判 fail：版本未动的包其 tag 必然已存在（上次发布所打），属常态。
      // 真正的重复发布由 registry 检查（版本是否已上架）与 release.mjs 幂等跳过兜底
      report('版本 tag', occupied ? 'info' : 'pass', `${tag}${occupied ? ' 已存在（该版本已发过，release.mjs 将跳过）' : ' 未被占用'}`)
    }
    return
  }
  if (!pkg.version) return
  const tagCandidates = target === 'claude-skill' && pkg.name
    ? [pkg.name.startsWith('@') ? `${pkg.name}@${pkg.version}` : `v${pkg.version}`]
    : [`v${pkg.version}`]
  const existing = tagCandidates.find((t) => run(`git tag -l '${t}'`).out === t)
  if (existing) {
    report('版本 tag', 'fail', `${existing} 已存在，禁止重复发版，先升级版本号`)
  } else {
    report('版本 tag', 'pass', `${tagCandidates.join(' / ')} 未被占用`)
  }
  const changelogVersion = changelogInfo?.first?.version
  if (changelogVersion && changelogVersion !== pkg.version) {
    report(
      '版本一致性',
      'warn',
      `package.json (${pkg.version}) 与 CHANGELOG 最新段 (${changelogVersion}) 不一致；若处于版本号升级前属正常`,
    )
  }
}

/**
 * 发布目标识别：读 package.json 静态字段与插件 manifest 判定分发渠道，决定 registry 检查与首发判定方式。
 * Why: 技能历史上默认"项目=npm 包"，但项目可能是 VSCode 扩展（vsce）、CLI、Claude Code 插件等
 * 非 npm 渠道。对这些项目跑 npm registry 检查会产出"404=首发""registry 版本 fail"等假信号
 * （npm 上还可能存在同名无关包，查到的版本号同样是误导）——必须先识别发布目标，
 * 再据此分流检查项，避免 agent 人工过滤噪音。
 * 只读静态字段与本地 manifest（不引入网络/工具调用），保持 preflight 毫秒级纯本地。
 */
function detectPublishTarget(pkg, dir = cwd, skillMono = null) {
  // 多技能共仓（per-directory 独立版本）优先于 package.json 字段判定：
  // 布局比字段更具体，且该形态根包通常 private 无 version，落入 npm 系兜底会产假信号
  if (skillMono?.length) return 'skill-monorepo'
  if (isSkillPackage(pkg)) return 'claude-skill'
  if (findPluginManifest(dir)) return 'cc-plugin'
  if (pkg.engines?.vscode) return 'vscode-extension'
  if (pkg.bin) return 'cli'
  return 'npm-package'
}

/**
 * 识别 Claude Code skill 包：入口为 SKILL.md，通过 `npx skills add owner/repo` 安装，
 * 不通过 npm registry 分发，因此跳过 registry / publishConfig / release 脚本等 npm 专属检查。
 */
function isSkillPackage(pkg) {
  if (!pkg) return false
  if (pkg.main === 'SKILL.md' || pkg.name?.endsWith('-skill')) return true
  const files = Array.isArray(pkg.files) ? pkg.files : []
  if (files.some((f) => f === 'SKILL.md' || f.endsWith('/SKILL.md'))) return true
  return false
}

/**
 * 展开所有实际发布目标：单包项目即根包；monorepo 展开 workspace 子包。
 * Why: preflight 历史上只查根 package.json，而 monorepo 根包通常 private，
 * 导致 registry 凭证、首发判定等检查被整体跳过——真正发布的是子包，
 * 全局 registry 为镜像且子包缺 publishConfig 的问题要到 publish 时才以
 * ENEEDAUTH 爆出来（读查询在镜像上成功，给出"一切正常"的假信号）。
 */
function enumeratePackages(rootPkg) {
  const patterns = readWorkspacePatterns(rootPkg)
  if (!patterns.length) {
    return [{ pkg: rootPkg, dir: cwd, label: rootPkg.name ?? 'root' }]
  }
  const dirs = []
  for (const pattern of patterns) {
    // 只支持 'dir' 与 'dir/*' 两种形式（覆盖绝大多数 workspace 配置），不引入 glob 依赖
    const m = pattern.match(/^(.+?)\/\*$/)
    if (m) {
      const base = join(cwd, m[1])
      if (!existsSync(base)) continue
      for (const entry of readdirSync(base, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        const dir = join(base, entry.name)
        if (existsSync(join(dir, 'package.json'))) dirs.push(dir)
      }
    } else {
      const dir = join(cwd, pattern)
      if (existsSync(join(dir, 'package.json'))) dirs.push(dir)
    }
  }
  const packages = []
  for (const dir of dirs) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
      packages.push({ pkg, dir, label: pkg.name ?? dir })
    } catch {
      report('workspace 包', 'fail', `${dir}/package.json 解析失败`)
    }
  }
  if (!packages.length) report('workspace', 'warn', '声明了 workspace 但未展开到任何包')
  return packages
}

/** 读取 workspace 声明：package.json workspaces 字段优先，其次 pnpm-workspace.yaml（轻量解析，不引入 yaml 依赖） */
function readWorkspacePatterns(rootPkg) {
  if (Array.isArray(rootPkg.workspaces)) return rootPkg.workspaces
  if (Array.isArray(rootPkg.workspaces?.packages)) return rootPkg.workspaces.packages
  const file = join(cwd, 'pnpm-workspace.yaml')
  if (!existsSync(file)) return []
  const patterns = []
  let inPackages = false
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (/^packages:/.test(line)) {
      inPackages = true
      continue
    }
    if (!inPackages) continue
    const m = line.match(/^\s+-\s*['"]?([^'"\s]+)['"]?\s*$/)
    if (m) patterns.push(m[1])
    else if (/^\S/.test(line)) break // 遇到下一个顶层 key，packages 块结束
  }
  return patterns
}

/**
 * 逐包校验有效发布 registry 是否符合预期。
 * 有效发布 registry 优先级：publishConfig.registry > @scope:registry（npmrc）> 全局 registry——
 * npm / pnpm / changeset publish 都按此优先级解析发布目标。
 * Why: 镜像源（npmmirror 等）是只读的，全局 registry 配成镜像本意是加速 install，
 * 但若包未声明 publishConfig.registry，publish 会跟随全局配置发往镜像，
 * 以 ENEEDAUTH 或 405 爆出来。声明了 publishConfig 或 scope registry 视为显式意图，放行。
 */
function checkPublishRegistries(packages, isMonorepo) {
  const publishable = packages.filter(
    ({ pkg, dir }) => !pkg.private && pkg.name && !isSkillPackage(pkg) && detectPublishTarget(pkg, dir) !== 'cc-plugin',
  )
  if (!publishable.length) return
  const globalRegistry = normalizeRegistry(run('npm config get registry').out)
  const scopeCache = new Map()
  const scopeRegistry = (name) => {
    const scope = name.startsWith('@') ? name.split('/')[0] : null
    if (!scope) return null
    if (!scopeCache.has(scope)) {
      const out = run('npm config get ' + scope + ':registry').out
      scopeCache.set(scope, out && out !== 'undefined' ? normalizeRegistry(out) : null)
    }
    return scopeCache.get(scope)
  }

  for (const { pkg } of publishable) {
    const label = isMonorepo ? ` (${pkg.name})` : ''
    const declared = normalizeRegistry(pkg.publishConfig?.registry)
    const scoped = scopeRegistry(pkg.name)

    if (declared && isOfficialRegistry(declared)) {
      report(`publish registry${label}`, 'pass', 'publishConfig → 官方源')
    } else if (declared) {
      report(`publish registry${label}`, 'info', `publishConfig → ${declared}（私有源，确认已登录该源）`)
    } else if (scoped) {
      report(`publish registry${label}`, 'info', `npmrc ${pkg.name.split('/')[0]}:registry → ${scoped}（确认已登录该源）`)
    } else if (isOfficialRegistry(globalRegistry)) {
      report(`publish registry${label}`, 'pass', '默认 registry 即官方源')
    } else {
      report(
        `publish registry${label}`,
        'fail',
        `${pkg.name} 无 publishConfig.registry，发布目标将跟随全局 registry = ${globalRegistry}（镜像/私有源通常只读，publish 会 ENEEDAUTH 或发到错误源）。` +
          '修复：package.json 添加 "publishConfig": { "access": "public", "registry": "https://registry.npmjs.org/" }',
      )
    }

    // scoped 包默认 private 发布；publish 工具链（changeset config.access / npmrc access=public）有全局配置时可忽略
    if (pkg.name.startsWith('@') && pkg.publishConfig?.access !== 'public') {
      report(`publish access${label}`, 'warn', 'scoped 包未在 publishConfig 声明 access: public（若发布工具链无全局 access 配置，会默认发布为 private）')
    }
  }
}

// ─── 发布后校验 ──────────────────────────────────────────────

function checkPostTag(pkg, target, packages = [], isMonorepo = false) {
  if (isMonorepo) {
    // 逐可发布包校验 <name>@<version> tag——monorepo 根版本无 tag 语义，
    // 查 v<根版本> 只会产出「发版未完成」的假 fail
    const wanted = packages.filter(({ pkg: sub }) => !sub.private && sub.name && sub.version)
    const remoteTags = run(
      `git ls-remote --tags origin ${wanted.map(({ pkg: sub }) => `'${sub.name}@${sub.version}'`).join(' ')}`,
      20_000,
    ).out
    for (const { pkg: sub } of wanted) {
      const tag = `${sub.name}@${sub.version}`
      const local = run(`git tag -l '${tag}'`).out === tag
      report(`git tag (${sub.name})`, local ? 'pass' : 'fail', local ? `${tag} 已创建` : `${tag} 不存在，发版未完成`)
      const remote = remoteTags.includes(tag)
      report(`远程 tag (${sub.name})`, remote ? 'pass' : 'warn', remote ? `${tag} 已推送` : `${tag} 未在远程，确认已 push --tags`)
    }
    return
  }
  const tagCandidates = target === 'claude-skill' && pkg.name
    ? [pkg.name.startsWith('@') ? `${pkg.name}@${pkg.version}` : `v${pkg.version}`]
    : [`v${pkg.version}`]
  const local = tagCandidates.find((t) => run(`git tag -l '${t}'`).out === t)
  if (local) {
    report('git tag', 'pass', `${local} 已创建`)
  } else {
    report('git tag', 'fail', `${tagCandidates.join(' / ')} 不存在，发版未完成`)
  }
  const remoteTags = run(`git ls-remote --tags origin ${tagCandidates.map((t) => `'${t}'`).join(' ')}`, 20_000).out
  const remote = tagCandidates.find((t) => remoteTags.includes(t))
  if (remote) {
    report('远程 tag', 'pass', `${remote} 已推送`)
  } else {
    report('远程 tag', 'warn', `${tagCandidates.join(' / ')} 未在远程，确认是否已 push --tags`)
  }
}

// ─── 主流程 ──────────────────────────────────────────────────

async function main() {
  if (!checkGitRepo()) return
  const rootPkg = readPackage()
  const skillMono = detectSkillMonorepo(cwd)
  const rootTarget = rootPkg
    ? detectPublishTarget(rootPkg, cwd, skillMono)
    : skillMono
      ? 'skill-monorepo'
      : null
  // monorepo 展开 workspace 子包——真正的发布目标是这些包，而非（通常 private 的）根包
  const packages = rootPkg ? enumeratePackages(rootPkg) : []
  const isMonorepo = rootPkg && !(packages.length === 1 && packages[0].dir === cwd)

  if (rootPkg) {
    if (isMonorepo) {
      // 发布/跳过清单分列：可发布范围在 Step 0 即显式可见——"某工程包该不该发"
      // 这类决策（如 eslint-config 转 private）应发生在版本规划前，而非发版中途
      const publishable = packages.filter(({ pkg }) => !pkg.private)
      const skipped = packages.filter(({ pkg }) => pkg.private)
      report(
        'workspace',
        'info',
        `${packages.length} 个包：将发布 ${publishable.length}（${publishable.map(({ label }) => label).join(', ') || '无'}）` +
          (skipped.length ? `；跳过 private ${skipped.length}（${skipped.map(({ label }) => label).join(', ')}）` : ''),
      )
    } else {
      report('包', 'info', `${rootPkg.name ?? '(unnamed)'}@${rootPkg.version ?? '?'}${rootPkg.private ? ' (private)' : ''}`)
    }
    report('发布目标', 'info', rootTarget)
  }

  if (isPost) {
    if (rootTarget === 'skill-monorepo') {
      results.push(...(await collectPostSkillMonorepo(skillMono)))
    } else {
      if (isMonorepo || rootPkg?.version) checkPostTag(rootPkg, rootTarget, packages, isMonorepo)
      // bump 后复核三处版本同步（plugin.json / marketplace version + ref）
      if (rootTarget === 'cc-plugin') checkCcPluginVersionSync(rootPkg)
      const nested = await Promise.all(
        packages.map(({ pkg, dir, label }) => collectPostRegistry(pkg, detectPublishTarget(pkg, dir), isMonorepo ? label : '')),
      )
      for (const checks of nested) results.push(...checks)
    }
  } else {
    checkWorktree()
    checkBranchSync()
    // skill monorepo 无 v* 仓级 tag，分支模型探测改用 <skill>@* 标签（按创建时间取最新）
    if (rootTarget === 'skill-monorepo') {
      probeBranchModel('*@*', '-creatordate')
      checkSkillMonorepo(skillMono, rootPkg)
    } else {
      // npm monorepo 的 tag 是包作用域（<name>@<version>），只用 v* 探测会误报首发；
      // 兼容仓级 v* 约定，按创建时间取最新（跨包版本序无意义）
      const publishableNames = packages.filter(({ pkg }) => !pkg.private && pkg.name).map(({ pkg }) => pkg.name)
      if (isMonorepo && publishableNames.length) {
        probeBranchModel([...publishableNames.map((n) => `${n}@*`), 'v*'], '-creatordate')
      } else {
        probeBranchModel()
      }
      const changelogInfo = checkChangelog()
      if (rootPkg) {
        checkReleaseScripts(rootPkg, rootTarget)
        // 版本一致性/tag 占用：monorepo 逐可发布包进行（根包 version 无发版语义），单包看根版本
        checkVersionConsistency(rootPkg, changelogInfo, rootTarget, packages, isMonorepo)
        // bump 前发现存量脱节（上次发版漏同步的拦截点）
        if (rootTarget === 'cc-plugin') checkCcPluginVersionSync(rootPkg)
        const collected = await Promise.all(
          packages.map(({ pkg, dir, label }) => collectRegistry(pkg, detectPublishTarget(pkg, dir), isMonorepo ? label : '')),
        )
        const firstPublishNames = new Set()
        for (const { name, checks, firstPublish } of collected) {
          results.push(...checks)
          if (firstPublish) firstPublishNames.add(name)
        }
        checkFirstPublishMetadata(packages, firstPublishNames)
        checkPublishRegistries(packages, isMonorepo)
      }
    }
  }
}

await main()

const fails = results.filter((r) => r.status === 'fail').length
const warns = results.filter((r) => r.status === 'warn').length

if (asJson) {
  console.log(JSON.stringify({ mode: isPost ? 'post' : 'pre', cwd, fails, warns, results }, null, 2))
} else {
  const ICONS = { pass: '✓', fail: '✗', warn: '⚠', info: '·' }
  for (const r of results) console.log(`${ICONS[r.status]} ${r.name}${r.detail ? ` — ${r.detail}` : ''}`)
  console.log(`\n${isPost ? 'postflight' : 'preflight'}: ${fails} fail, ${warns} warn, 共 ${results.length} 项`)
}

process.exit(fails > 0 ? 1 : 0)
