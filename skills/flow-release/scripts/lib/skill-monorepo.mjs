/**
 * skill monorepo（多技能共仓、逐技能独立版本）形态的检查。
 *
 * 版本载体是各技能 SKILL.md frontmatter 的 metadata.version，tag 形态为
 * <skill>@<version>，分发是 git 推送——npm 系检查（registry、publishConfig、
 * release 脚本链、根 CHANGELOG Unreleased）对该形态全部不适用。
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

export function createSkillMonorepoChecks({ cwd, run, runAsync, report }) {
  /**
   * 识别 skill monorepo：skills/<name>/SKILL.md 存在且 frontmatter 含 metadata.version。
   * 返回 [{ name, version, file }]；无该布局或技能均未版本化时返回 null。
   */
  function detectSkillMonorepo(dir) {
    const skillsDir = join(dir, 'skills')
    if (!existsSync(skillsDir)) return null
    let entries
    try {
      entries = readdirSync(skillsDir, { withFileTypes: true })
    } catch {
      return null
    }
    const found = []
    for (const e of entries) {
      if (!e.isDirectory()) continue
      const file = join(skillsDir, e.name, 'SKILL.md')
      if (!existsSync(file)) continue
      const version = readSkillVersion(file)
      if (version) found.push({ name: e.name, version, file })
    }
    return found.length ? found : null
  }

  /** 读 SKILL.md frontmatter 的 metadata.version；缺失或非 semver 返回 null（视为未版本化） */
  function readSkillVersion(skillFile) {
    try {
      const text = readFileSync(skillFile, 'utf8')
      const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
      if (!fm) return null
      const lines = fm[1].split(/\r?\n/)
      const metaIdx = lines.findIndex((l) => /^metadata\s*:/.test(l) && !/^\s/.test(l))
      if (metaIdx < 0) return null
      for (let i = metaIdx + 1; i < lines.length && /^\s+\S/.test(lines[i]); i++) {
        const m = /^\s+version\s*:\s*"?([^"\s]+)"?\s*$/.exec(lines[i])
        if (m) return /^\d+\.\d+\.\d+$/.test(m[1]) ? m[1] : null
      }
      return null
    } catch {
      return null
    }
  }

  /**
   * skill monorepo 发版前检查：逐技能版本/CHANGELOG/tag + bump 单入口。
   * bump 单入口强制的原因：版本三落点（frontmatter/CHANGELOG/tag）手工分头改必然漂移。
   */
  function checkSkillMonorepo(skills, rootPkg) {
    report('技能清单', 'info', `${skills.length} 个已版本化技能：${skills.map((s) => `${s.name}@${s.version}`).join(', ')}`)

    const bumpScript = rootPkg?.scripts?.bump
    const bumpFile = join(cwd, 'skills', 'flow-skill', 'scripts', 'bump.mjs')
    if (bumpScript) {
      report('bump 入口', 'pass', `scripts.bump = ${bumpScript}`)
    } else if (existsSync(bumpFile)) {
      report('bump 入口', 'pass', 'skills/flow-skill/scripts/bump.mjs')
    } else {
      report('bump 入口', 'fail', '根 package.json 无 scripts.bump 且 skills/flow-skill/scripts/bump.mjs 不存在，版本三落点将手工分头改')
    }

    for (const { name, version } of skills) {
      const changelogFile = join(cwd, 'skills', name, 'CHANGELOG.md')
      if (!existsSync(changelogFile)) {
        report(`CHANGELOG(${name})`, 'fail', 'CHANGELOG.md 不存在——疑似绕开 bump 手工改过 frontmatter')
        continue
      }
      const m = readFileSync(changelogFile, 'utf8').match(/^## \[(.+?)\] - (\S+)/m)
      if (!m) {
        report(`CHANGELOG(${name})`, 'fail', '缺少版本段（## [x.y.z] - YYYY-MM-DD）')
        continue
      }
      const [, topVersion, date] = m
      if (topVersion !== version) {
        // 与根包「版本一致性」同级：改版进行中属正常，warn 不阻断
        report(`CHANGELOG(${name})`, 'warn', `顶部版本 ${topVersion} ≠ frontmatter ${version}（若处于 bump 前属正常）`)
      } else if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        report(`CHANGELOG(${name})`, 'fail', `[${topVersion}] 的日期 "${date}" 非 ISO 8601`)
      } else {
        report(`CHANGELOG(${name})`, 'pass', `[${topVersion}] - ${date}`)
      }

      const currentTag = `${name}@${version}`
      const latest = run(`git tag -l '${name}@*' --sort=-v:refname | head -1`)
      if (latest.ok && latest.out) {
        if (latest.out === currentTag) {
          report(`tag(${name})`, 'pass', `当前版本 tag ${currentTag} 在案`)
        } else {
          report(`tag(${name})`, 'warn', `最新 tag ${latest.out} ≠ 当前版本 ${currentTag}（上次 bump 未打 tag 或刚 bump 未发版）`)
        }
      } else {
        report(`tag(${name})`, 'info', '无 tag（未基线化技能，首发须显式版本 bump）')
      }
    }
  }

  /** skill monorepo 发布后校验（收集版）：各技能当前版本 tag 本地存在且已推远程；ls-remote 为网络往返，逐技能并行后返回扁平结果 */
  async function collectPostSkillMonorepo(skills) {
    const nested = await Promise.all(
      skills.map(async ({ name, version }) => {
        const checks = []
        const tag = `${name}@${version}`
        if (run(`git tag -l ${tag}`).out === tag) {
          checks.push({ name: `git tag(${name})`, status: 'pass', detail: `${tag} 已创建` })
          const remote = (await runAsync(`git ls-remote --tags origin ${tag}`, 20_000)).out
          if (remote.includes(tag)) {
            checks.push({ name: `远程 tag(${name})`, status: 'pass', detail: `${tag} 已推送` })
          } else {
            checks.push({ name: `远程 tag(${name})`, status: 'warn', detail: `${tag} 未在远程，确认已 push --tags` })
          }
        } else {
          checks.push({ name: `git tag(${name})`, status: 'fail', detail: `${tag} 不存在，发版未完成` })
        }
        return checks
      }),
    )
    return nested.flat()
  }

  return { detectSkillMonorepo, checkSkillMonorepo, collectPostSkillMonorepo }
}
