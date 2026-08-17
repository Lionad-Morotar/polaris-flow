#!/usr/bin/env node
/**
 * verify-docs-index：GSD 文档索引完整性双向校验（接入 flow-docs Workflow A 收尾）。
 *
 * 两条不变量：
 *
 * 1. 正向——无孤儿文档：docs/ 下每个 markdown（排除 adr/**、agents/domain.md、
 *    gitignored）都必须在 .planning/codebase/*.md 或 CLAUDE.md 中被引用。
 *    排除依据：adr 是决策记录（自编号索引）、agents/domain.md 是技能领域文档（自足）、
 *    gitignored 涵盖 plans/reports/reviews/dissections/research/thoughts/ui 等
 *    flow-dev / flow-code-review 切片产物（按日期自索引，不纳入结构化文档）。
 *    「在 CLAUDE.md 引用也算合规」——CLAUDE.md 是合法索引承载源，但不单独要求其覆盖率。
 *
 * 2. 反向——禁引 gitignore 目标：索引源中所有指向仓库内 .md/.markdown/.mdx 的链接，
 *    其目标不得被 gitignore。gitignore 判定用 git 原生 `git check-ignore`
 *    （已纳入版本控制的文件即使路径匹配 .gitignore 也判为不忽略——已跟踪 = 可索引，
 *    这是预期语义，无需自维护已跟踪文件集合）。
 *
 * 只校验 inline 链接 `[label](target)`，不处理 reference 链接 `[label][ref]` + `[ref]: url`
 * （GSD 文档惯例是 inline）。跳过代码围栏与行内代码内的链接（可能演示链接格式本身）。
 *
 * 用法：
 *   node verify-docs-index.mjs [--root <path>] [--docs <rel>] [--codebase <rel>] [--claude <rel>]
 *
 * 默认：root=git toplevel；docs=docs；codebase=.planning/codebase；claude=CLAUDE.md
 * 失败以非零退出码返回，JSON 汇总供调用方解析。
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

// ---- 参数解析 ----

const argv = process.argv.slice(2);
function argValue(flag) {
  const i = argv.indexOf(flag);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}

function gitRoot(cwd) {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}

const rootArg = argValue("--root");
const root = rootArg ? path.resolve(rootArg) : gitRoot(process.cwd());
const docsRel = argValue("--docs") ?? "docs";
const codebaseRel = argValue("--codebase") ?? ".planning/codebase";
const claudeRel = argValue("--claude") ?? "CLAUDE.md";

// ---- 工具 ----

/** 递归收集目录下所有 .md 文件（绝对路径）；跳过 .git / node_modules 黑洞。 */
function walkMd(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walkMd(p, out);
    else if (entry.isFile() && /\.md$/i.test(entry.name)) out.push(p);
  }
  return out;
}

/** 绝对路径 → root 相对 posix 路径（集合比较的规范化形式）。 */
function toRelPosix(abspath) {
  return path.relative(root, abspath).split(path.sep).join("/");
}

const ignoreCache = new Map();
/** git 原生判定：true = 被 gitignore。已跟踪文件恒 false。 */
function isIgnored(abspath) {
  if (ignoreCache.has(abspath)) return ignoreCache.get(abspath);
  // 传相对仓库根的 posix 路径——git check-ignore 按此匹配 .gitignore 相对模式；
  // 传绝对路径对「精确文件名规则」不可靠（目录前缀规则才碰巧命中）。
  const rel = path.relative(root, abspath).split(path.sep).join("/");
  let ignored = false;
  try {
    execFileSync("git", ["check-ignore", "--quiet", "--", rel], {
      cwd: root,
      encoding: "utf-8",
      stdio: "ignore",
    });
    ignored = true; // 退出码 0 = 命中忽略规则
  } catch {
    ignored = false; // 非 0 = 未忽略（或文件已跟踪 / 不存在）
  }
  ignoreCache.set(abspath, ignored);
  return ignored;
}

// docs 候选排除项：adr 整目录、agents/domain.md 单文件（与 cwd/root 无关，按 rel posix 匹配）
const DOCS_EXCLUDE_RE = /^docs\/adr\/|^docs\/agents\/domain\.md$/i;

/** docs 候选：docs 下全部 md，减去 adr 子目录、agents/domain.md、gitignored。 */
function collectDocsCandidates(docsDir) {
  const kept = [];
  for (const abspath of walkMd(docsDir)) {
    const rel = toRelPosix(abspath);
    if (DOCS_EXCLUDE_RE.test(rel)) continue;
    if (isIgnored(abspath)) continue;
    kept.push(rel);
  }
  return kept.sort();
}

// inline 链接 [label](target)；target 可能带 "title" 或 #anchor
const LINK_RE = /\[([^\]]*)\]\(([^)]+)\)/g;
const DOC_EXT = /\.(md|markdown|mdx)$/i;

/**
 * 从索引源文件抽取 inline 链接的根相对 posix 目标。
 * 跳过代码围栏与行内代码（可能演示链接格式），跳过外链 / 纯锚点 / root 外目标。
 */
function extractLinkTargets(sourceAbs) {
  const targets = [];
  const text = readFileSync(sourceAbs, "utf-8");
  const lines = text.split("\n");
  let inFence = false;

  lines.forEach((raw, idx) => {
    if (/^\s*(```|~~~)/.test(raw)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    const line = raw.replace(/`[^`]*`/g, ""); // 行内代码可能演示链接格式，剔除
    LINK_RE.lastIndex = 0;
    let m;
    while ((m = LINK_RE.exec(line)) !== null) {
      let target = m[2].trim().split(/\s+/)[0]; // 取首 token，丢弃 "title"
      target = target.replace(/^<(.+)>$/, "$1"); // 剥 <...> 包裹
      if (!target) continue;
      if (/^(https?:|mailto:|ftp:|data:|irc:)/i.test(target)) continue; // 外链
      if (target.startsWith("#")) continue; // 纯锚点
      const hashIdx = target.indexOf("#");
      if (hashIdx >= 0) target = target.slice(0, hashIdx);
      if (!target) continue;
      const resolved = path.resolve(path.dirname(sourceAbs), target);
      const rel = path.relative(root, resolved).split(path.sep).join("/");
      if (rel.startsWith("..")) continue; // 落在 root 外，不校验
      targets.push({ rel, source: toRelPosix(sourceAbs), line: idx + 1 });
    }
  });
  return targets;
}

// ---- 主流程 ----

const result = {
  ok: true,
  root,
  docsDir: docsRel,
  codebaseDir: codebaseRel,
  claudeFile: claudeRel,
  stats: {},
  unindexed: [],
  gitignoredRefs: [],
  errors: [],
};

function fail(msg) {
  result.ok = false;
  result.errors.push(msg);
}

if (!root) {
  fail("无法定位 git 仓库根（传入 --root 或在 git 仓库内运行）");
} else {
  const docsDir = path.join(root, docsRel);
  const codebaseDir = path.join(root, codebaseRel);
  const claudeFile = path.join(root, claudeRel);

  // 1. docs 候选
  const candidates = collectDocsCandidates(docsDir);
  result.stats.docsCandidates = candidates.length;
  if (!existsSync(docsDir)) fail(`docs 目录不存在: ${docsRel}`);

  // 2. 索引源：.planning/codebase/**/*.md + CLAUDE.md（若存在）
  const sources = [];
  if (existsSync(codebaseDir)) {
    sources.push(...walkMd(codebaseDir));
  } else {
    fail(`codebase 目录不存在: ${codebaseRel}`);
  }
  if (existsSync(claudeFile)) sources.push(claudeFile);
  result.stats.indexSources = sources.length;

  // 3. 抽取全部链接目标
  const allTargets = sources.flatMap(extractLinkTargets);
  const indexedRelSet = new Set(allTargets.map((t) => t.rel));
  result.stats.indexedTargets = indexedRelSet.size;

  // 4. 正向：孤儿文档检查（每个 docs 候选必须被索引源引用）
  for (const rel of candidates) {
    if (!indexedRelSet.has(rel)) result.unindexed.push(rel);
  }

  // 5. 反向：gitignore 引用检查（仅文档类后缀目标）
  const seen = new Set();
  for (const t of allTargets) {
    if (!DOC_EXT.test(t.rel)) continue;
    const key = `${t.source}:${t.line}:${t.rel}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (isIgnored(path.join(root, t.rel))) {
      result.gitignoredRefs.push({ source: t.source, line: t.line, target: t.rel });
    }
  }

  if (result.unindexed.length > 0) result.ok = false;
  if (result.gitignoredRefs.length > 0) result.ok = false;
}

console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
