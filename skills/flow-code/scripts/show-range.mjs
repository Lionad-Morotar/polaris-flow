#!/usr/bin/env node
/**
 * flow-code --show 对比基探测：按退化链选定 diff range
 *   L1 upstream（origin 同名分支）→ L2 默认分支 → L3 近一个月时间窗
 * 退出码：0 有变动；1 无近期变动；3 环境错误
 * 输出 JSON：{ ok, strategy, range, base, branch, commits, fallbacks }
 *   range 为三点形式（merge-base 起算），commits 为两点 count（HEAD 独有提交数）
 *   fallbacks 记录每级退化原因，供报告交代裁量路径
 */
import { execSync } from 'node:child_process'

const out = (obj, code) => {
  process.stdout.write(JSON.stringify(obj, null, 2) + '\n')
  process.exit(code)
}
const run = (cmd) => execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
const tryRun = (cmd) => {
  try {
    const r = run(cmd)
    return r === '' ? null : r
  } catch {
    return null
  }
}

if (tryRun('git rev-parse --is-inside-work-tree') !== 'true') {
  out({ ok: false, error: 'not a git repository' }, 3)
}
if (!tryRun('git rev-parse --verify --quiet HEAD^{commit}')) {
  out({ ok: false, error: 'no commits yet' }, 3)
}

const branch = tryRun('git branch --show-current') // detached HEAD 时为 null
const fallbacks = []

// L1：upstream
const upstream = tryRun('git rev-parse --abbrev-ref @{upstream}')
if (upstream) {
  const ahead = parseInt(run(`git rev-list --count "${upstream}..HEAD"`), 10)
  if (ahead > 0) {
    out({ ok: true, strategy: 'upstream', range: `${upstream}...HEAD`, base: upstream, branch, commits: ahead, fallbacks }, 0)
  }
  fallbacks.push(`相对 upstream ${upstream} 无领先提交，退化到默认分支对比`)
} else {
  fallbacks.push('当前分支无 upstream，退化到默认分支对比')
}

// L2：默认分支；排除自比与 L1 已处理的同 ref
const candidates = ['origin/main', 'origin/master', 'main', 'master', 'origin/develop', 'develop']
let defaultRef = null
for (const ref of candidates) {
  if (tryRun(`git rev-parse --verify --quiet "${ref}^{commit}"`)) {
    defaultRef = ref
    break
  }
}
if (!defaultRef) {
  fallbacks.push('找不到默认分支（main/master/develop），退化到近一个月时间窗')
} else if (defaultRef === branch || defaultRef === upstream) {
  fallbacks.push(`默认分支 ${defaultRef} 即当前分支或 upstream，退化到近一个月时间窗`)
} else {
  const ahead = parseInt(run(`git rev-list --count "${defaultRef}..HEAD"`), 10)
  if (ahead > 0) {
    out({ ok: true, strategy: 'default-branch', range: `${defaultRef}...HEAD`, base: defaultRef, branch, commits: ahead, fallbacks }, 0)
  }
  fallbacks.push(`相对默认分支 ${defaultRef} 无未合并提交，退化到近一个月时间窗`)
}

// L3：近一个月时间窗
const since = '1 month ago'
const count = parseInt(run(`git rev-list --count --since="${since}" HEAD`), 10)
if (count > 0) {
  out({ ok: true, strategy: 'month', range: `HEAD --since="${since}"`, base: null, branch, commits: count, fallbacks }, 0)
}
out({ ok: false, strategy: null, branch, commits: 0, fallbacks, message: '近一个月无提交，无近期变动可总结' }, 1)
