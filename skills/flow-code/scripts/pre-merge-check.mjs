#!/usr/bin/env node
/**
 * flow-code --show 合并前确认点事实探测（direction=diverged/behind 形态时由 Workflow A 调用，亦可显式直跑）
 *   用法：node pre-merge-check.mjs [theirs] [base]
 *     theirs 缺省 @{upstream}；base 缺省 merge-base(HEAD, theirs)
 * 退出码：0 正常（含无确认点）/ 3 环境错误
 * 输出 JSON：{ ok, base, theirs, overlap, migrations }
 *   overlap：双边都改动的文件（merge 文本冲突候选；语义冲突不在其列，靠归簇期识别）
 *   migrations：theirs 树上探测到 drizzle 风格 journal（**\/migrations/meta/_journal.json）时逐库核对，否则 null
 *     unregistered：theirs 侧存在但 journal 未登记的迁移文件（游离即不执行——drizzle 程序化 migrate 只按 journal 跑）
 *     numberCollisions：同目录同数字前缀的迁移文件组（编号撞车，顺序歧义）
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

const theirs = process.argv[2] ?? tryRun('git rev-parse --abbrev-ref @{upstream}')
if (!theirs) {
  out({ ok: false, error: '无参数且当前分支无 upstream，无法确定 theirs' }, 3)
}
if (!tryRun(`git rev-parse --verify --quiet "${theirs}^{commit}"`)) {
  out({ ok: false, error: `theirs 引用不可解析: ${theirs}` }, 3)
}
const base = process.argv[3] ?? tryRun(`git merge-base HEAD "${theirs}"`)
if (!base) {
  out({ ok: false, error: `HEAD 与 ${theirs} 无共同祖先（无关历史）` }, 3)
}

const changedFiles = (range) => new Set((tryRun(`git diff --name-only ${range}`) ?? '').split('\n').filter(Boolean))
const ours = changedFiles(`${base}..HEAD`)
const theirsFiles = changedFiles(`${base}..${theirs}`)
const overlap = [...ours].filter((f) => theirsFiles.has(f)).sort()

// 迁移 journal 条件核对：无 drizzle 结构的项目跳过（migrations=null），不硬编码项目假设
const treeFiles = (tryRun(`git ls-tree -r --name-only "${theirs}"`) ?? '').split('\n').filter(Boolean)
const journalPaths = treeFiles.filter((f) => f.endsWith('migrations/meta/_journal.json'))

let migrations = null
if (journalPaths.length > 0) {
  migrations = journalPaths.map((journal) => {
    const dir = journal.replace(/\/meta\/_journal\.json$/, '')
    const sqlFiles = treeFiles
      .filter((f) => f.startsWith(`${dir}/`) && f.endsWith('.sql') && !f.slice(dir.length + 1).includes('/'))
      .map((f) => f.slice(dir.length + 1))
    let registered = []
    try {
      const parsed = JSON.parse(run(`git show "${theirs}:${journal}"`))
      registered = (parsed.entries ?? []).map((e) => e.tag)
    } catch {
      // journal 不可解析视同全未登记，由 unregistered 全量呈现
    }
    const unregistered = sqlFiles.filter((f) => !registered.includes(f.replace(/\.sql$/, ''))).sort()
    const byPrefix = new Map()
    for (const f of sqlFiles) {
      const m = f.match(/^(\d+)/)
      if (!m) continue
      const group = byPrefix.get(m[1]) ?? []
      group.push(f)
      byPrefix.set(m[1], group)
    }
    const numberCollisions = [...byPrefix.values()].filter((g) => g.length > 1).map((g) => g.sort())
    return { journal, unregistered, numberCollisions }
  })
}

out({ ok: true, base, theirs, overlap, migrations }, 0)
