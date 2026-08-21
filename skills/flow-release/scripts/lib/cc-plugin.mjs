/**
 * Claude Code 插件（经 marketplace git clone 分发）形态的检查。
 *
 * 识别依据是 plugin.json manifest 存在性；与 npm registry 无关。
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

export function createCcPluginChecks({ cwd, report }) {
  /**
   * Claude Code 插件 manifest 候选位置：仓库根（插件即仓库）或 plugin/ 子目录（插件为仓库子部分）。
   * 存在 plugin.json 即判定经 marketplace（git clone）分发，与 npm registry 无关。
   */
  const PLUGIN_MANIFEST_CANDIDATES = ['.claude-plugin/plugin.json', 'plugin/.claude-plugin/plugin.json']

  function findPluginManifest(dir) {
    return PLUGIN_MANIFEST_CANDIDATES.find((rel) => existsSync(join(dir, rel))) ?? null
  }

  /**
   * 在仓库内定位含指定插件条目的 marketplace.json：根目录、一层子目录、两层子目录
   * （覆盖 packages/claude-plugins 这类子模块布局）。返回 { path, entry } 或 null。
   * marketplace 也可能在独立仓库维护，找不到不视为错误。
   */
  function findMarketplaceEntry(dir, pluginName) {
    const candidates = ['.claude-plugin/marketplace.json']
    const skip = new Set(['node_modules', '.git'])
    for (const e1 of readdirSync(dir, { withFileTypes: true })) {
      if (!e1.isDirectory() || skip.has(e1.name) || e1.name.startsWith('.')) continue
      candidates.push(`${e1.name}/.claude-plugin/marketplace.json`)
      let sub
      try {
        sub = readdirSync(join(dir, e1.name), { withFileTypes: true })
      } catch {
        continue
      }
      for (const e2 of sub) {
        if (e2.isDirectory() && !skip.has(e2.name) && !e2.name.startsWith('.')) {
          candidates.push(`${e1.name}/${e2.name}/.claude-plugin/marketplace.json`)
        }
      }
    }
    for (const rel of candidates) {
      const p = join(dir, rel)
      if (!existsSync(p)) continue
      try {
        const market = JSON.parse(readFileSync(p, 'utf8'))
        const entry = (market.plugins ?? []).find((pl) => pl.name === pluginName)
        if (entry) return { path: rel, entry }
      } catch {
        report('marketplace.json', 'fail', `${rel} JSON 解析失败`)
      }
    }
    return null
  }

  /**
   * CC 插件三处版本同步检查：package.json / plugin.json / marketplace.json(version + source.ref)。
   * Why: 三处各司其职，漏更有特定故障形态且全部静默——plugin.json 决定安装版本标签
   * （installPath 目录名与 installed_plugins.json），漏更导致标签滞后内容，用户按错版本排障；
   * marketplace 的 version 只是索引展示，source.ref 决定 install 实际拉取的代码，
   * 缺省跟随默认分支 HEAD，索引声称的版本与内容脱节。人工同步确有漏更前科，故机械强制。
   * preflight（bump 前）发现存量脱节，postflight（bump 后）复核同步完整性。
   */
  function checkCcPluginVersionSync(pkg) {
    const manifestRel = findPluginManifest(cwd)
    if (!manifestRel) return
    let pluginVersion = null
    try {
      pluginVersion = JSON.parse(readFileSync(join(cwd, manifestRel), 'utf8')).version
    } catch {
      report('版本同步 plugin.json', 'fail', `${manifestRel} JSON 解析失败`)
      return
    }
    if (pluginVersion !== pkg.version) {
      report(
        '版本同步 plugin.json',
        'fail',
        `${manifestRel} (${pluginVersion}) ≠ package.json (${pkg.version})——安装版本标签取自 plugin.json，脱节会导致 installPath 与 installed_plugins.json 标签失真`,
      )
    } else {
      report('版本同步 plugin.json', 'pass', pluginVersion)
    }

    const found = findMarketplaceEntry(cwd, pkg.name)
    if (!found) {
      report('版本同步 marketplace', 'info', '仓库内未找到含本插件条目的 marketplace.json（可能在独立仓库维护），跳过')
      return
    }
    const { path: marketPath, entry } = found
    if (!entry.version) {
      report('版本同步 marketplace', 'warn', `${marketPath} 条目缺 version 字段，索引无法展示版本`)
    } else if (entry.version !== pkg.version) {
      report(
        '版本同步 marketplace',
        'fail',
        `${marketPath} (${entry.version}) ≠ package.json (${pkg.version})——索引不提示新版本，已安装用户不触发更新`,
      )
    } else {
      report('版本同步 marketplace', 'pass', entry.version)
    }

    const ref = entry.source?.ref
    const expectedRef = `v${pkg.version}`
    if (ref == null) {
      report(
        'marketplace source.ref',
        'warn',
        `${marketPath} 条目未锁 source.ref——install 将拉取默认分支 HEAD，索引声称的版本与内容静默漂移，建议锁定 "ref": "${expectedRef}"`,
      )
    } else if (ref !== expectedRef) {
      report(
        'marketplace source.ref',
        'fail',
        `source.ref (${ref}) ≠ 目标 tag (${expectedRef})——install 拉取内容与索引声明版本脱节`,
      )
    } else {
      report('marketplace source.ref', 'pass', ref)
    }
  }

  return { findPluginManifest, checkCcPluginVersionSync }
}
