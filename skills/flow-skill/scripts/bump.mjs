#!/usr/bin/env node
/**
 * flow 仓技能的版本化工具：一次完成「frontmatter 改版 + CHANGELOG prepend + commit + tag」。
 *
 * 为什么存在：版本信息有三处落点（SKILL.md 的 metadata.version、CHANGELOG.md、
 * git tag <skill>@<version>），手动维护三处必然漂移；state.json 打标与 resume
 * 漂移判定依赖 tag 命名一致，故收敛成单入口。
 *
 * 用法：
 *   node bump.mjs <skill> [patch|minor|major|x.y.z|alpha] "<条目1>" ["<条目2>"...] [--no-commit] [--no-tag]
 *
 * 版本生命周期：新技能以 alpha 基线化（打磨期不升版本，版本号是稳定性信号
 * 而非改动计数器），维护者显式拍板后给显式 semver（如 0.1.0）毕业；毕业后
 * 级别省略按 patch，重大功能变动才 minor，永不 major 除非用户明确指定。
 * 无版本技能必须给显式版本（alpha 或 semver）基线化，拒绝凭空 patch。
 *
 * 退出码：0 成功；1 校验/执行失败；3 用法错误。
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseFrontmatter } from "./lint/frontmatter.mjs";

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const SKILLS_ROOT = path.resolve(SCRIPTS_DIR, "..", "..");
const REPO_ROOT = path.resolve(SKILLS_ROOT, "..");

const SEMVER_RE = /^\d+\.\d+\.\d+$/;
const LEVELS = ["patch", "minor", "major"];

const argv = process.argv.slice(2);
const noCommit = argv.includes("--no-commit");
const noTag = argv.includes("--no-tag");
const positional = argv.filter((a) => !a.startsWith("--"));

function usage(message) {
  console.error(`用法错误: ${message}
  node bump.mjs <skill> [patch|minor|major|x.y.z|alpha] "<条目1>" ["<条目2>"...] [--no-commit] [--no-tag]`);
  process.exit(3);
}

function fail(message) {
  console.error(`bump 失败: ${message}`);
  process.exit(1);
}

if (positional.length < 1) usage("未提供技能名");
const skill = positional[0];
let level = "patch";
let entries = positional.slice(1);
if (positional[1] && (LEVELS.includes(positional[1]) || SEMVER_RE.test(positional[1]) || positional[1] === "alpha")) {
  level = positional[1];
  entries = positional.slice(2);
}
if (entries.length === 0) usage("CHANGELOG 条目至少一条");

const skillDir = path.join(SKILLS_ROOT, skill);
const skillFile = path.join(skillDir, "SKILL.md");
const changelogFile = path.join(skillDir, "CHANGELOG.md");
if (!existsSync(skillFile)) fail(`技能不存在或无 SKILL.md: ${skillDir}`);

// ---- 读取当前版本 ----

function readVersion(text) {
  const { attrs, structureError } = parseFrontmatter(text);
  if (structureError) fail(`${skill} frontmatter 结构错误: ${structureError}`);
  const meta = attrs.get("metadata");
  if (!meta) return { version: null, metaExists: false };
  if (meta.value.type !== "map" || !Array.isArray(meta.value.value)) {
    fail(`${skill} 的 metadata 不是块状 map，请手工规范为块状后再 bump`);
  }
  for (const line of meta.value.value) {
    const m = /^version\s*:\s*(.+)$/.exec(line);
    if (m) return { version: m[1].trim(), metaExists: true };
  }
  return { version: null, metaExists: true };
}

const oldText = readFileSync(skillFile, "utf-8");
const { version: oldVersion } = readVersion(oldText);

function bumpSemver(v, lvl) {
  const [a, b, c] = v.split(".").map(Number);
  if (lvl === "major") return `${a + 1}.0.0`;
  if (lvl === "minor") return `${a}.${b + 1}.0`;
  return `${a}.${b}.${c + 1}`;
}

function semverGt(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] > pb[i];
  }
  return false;
}

let newVersion;
if (SEMVER_RE.test(level) || level === "alpha") {
  newVersion = level;
  if (level === "alpha") {
    // alpha 是打磨态入口，覆盖既有版本等于把已发信号的技能打回毛坯，一律拒绝
    if (oldVersion) fail(`alpha 仅用于无版本技能的基线化，${skill} 当前版本: ${oldVersion}`);
  } else if (oldVersion && SEMVER_RE.test(oldVersion) && !semverGt(newVersion, oldVersion)) {
    fail(`显式版本 ${newVersion} 必须大于当前版本 ${oldVersion}`);
  }
  // oldVersion 为 alpha 时无法比较大小，显式 semver 即毕业，直接放行
} else {
  if (!oldVersion) fail(`${skill} 尚无版本，基线必须给显式版本（新技能 alpha，毕业 0.1.0 等 semver），不接受 ${level}`);
  if (!SEMVER_RE.test(oldVersion)) fail(`${skill} 当前为 ${oldVersion} 打磨期，不升版本；毕业请显式指定 semver（如 0.1.0）`);
  newVersion = bumpSemver(oldVersion, level);
}
if (oldVersion === newVersion) fail(`新旧版本相同: ${newVersion}`);

// ---- 改写 SKILL.md frontmatter ----
// 行级操作而非整体重写：frontmatter 里可能有注释与手写排版，全量序列化会抹掉

const lines = oldText.split("\n");
const closeIndex = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
if (lines[0]?.trim() !== "---" || closeIndex < 0) fail(`${skill} frontmatter 缺失或未闭合`);

const metaLineIndex = lines.findIndex((l, i) => i > 0 && i < closeIndex && /^metadata\s*:/.test(l) && !/^\s/.test(l));
let newLines;
if (metaLineIndex < 0) {
  newLines = [...lines.slice(0, closeIndex), "metadata:", `  version: ${newVersion}`, ...lines.slice(closeIndex)];
} else {
  // metadata 块的范围：自身行 + 后续缩进行，到下一个顶格键或 --- 为止
  let blockEnd = metaLineIndex + 1;
  while (blockEnd < closeIndex && (/^\s+\S/.test(lines[blockEnd]) || lines[blockEnd].trim() === "")) blockEnd++;
  const versionLineIndex = lines.findIndex(
    (l, i) => i > metaLineIndex && i < blockEnd && /^\s+version\s*:/.test(l),
  );
  if (versionLineIndex < 0) {
    newLines = [...lines.slice(0, blockEnd), `  version: ${newVersion}`, ...lines.slice(blockEnd)];
  } else {
    newLines = [...lines];
    newLines[versionLineIndex] = lines[versionLineIndex].replace(/version\s*:.*/, `version: ${newVersion}`);
  }
}

// ---- prepend CHANGELOG ----

const today = new Date().toLocaleDateString("sv-SE"); // 本地时区的 YYYY-MM-DD
const entryBlock = `## [${newVersion}] - ${today}\n\n${entries.map((e) => `- ${e}`).join("\n")}\n\n`;
let changelogText;
if (!existsSync(changelogFile)) {
  changelogText = `# Changelog\n\n格式基于 Keep a Changelog；级别约定：小改动 patch，重大功能变动 minor，永不 major 除非用户明确指定；新技能 alpha 起步，毕业才走 semver。\n\n${entryBlock}`;
} else {
  const old = readFileSync(changelogFile, "utf-8");
  const firstEntry = old.search(/^## \[/m);
  changelogText = firstEntry < 0 ? `${old.trimEnd()}\n\n${entryBlock}` : `${old.slice(0, firstEntry)}${entryBlock}${old.slice(firstEntry)}`;
}

// ---- 落盘前预检：dirty 检查必须在任何写盘之前 ----
// 先预写 version/CHANGELOG 再检查且失败不回滚，会留下"半 bump"工作区：
// 重跑报新旧版本相同，checkout 还原 CHANGELOG 又要求其改动确实只来自本次预写。
// 检查只读 git status，不依赖落盘内容，顺序本该如此。

function git(args) {
  return execFileSync("git", ["-C", REPO_ROOT, ...args], { encoding: "utf-8" }).trim();
}

if (!noCommit) {
  // 版本提交只许含这两个文件；技能目录有别的未提交改动时拒绝，避免裹挟进版本提交
  const dirty = git(["status", "--porcelain", "--", path.relative(REPO_ROOT, skillDir)])
    .split("\n")
    .filter((l) => l && !l.endsWith("SKILL.md") && !l.endsWith("CHANGELOG.md"));
  if (dirty.length > 0) {
    fail(`技能目录存在其他未提交改动，先另行提交:\n${dirty.join("\n")}`);
  }
}

// ---- 落盘 ----

writeFileSync(skillFile, newLines.join("\n"));
writeFileSync(changelogFile, changelogText);
console.log(`${skill}: ${oldVersion ?? "(无)"} → ${newVersion}`);

// ---- commit + tag ----

const relSkill = path.relative(REPO_ROOT, skillFile);
const relChangelog = path.relative(REPO_ROOT, changelogFile);
const tag = `${skill}@${newVersion}`;

if (!noCommit) {
  git(["add", relSkill, relChangelog]);
  git(["commit", "-m", `chore(${skill}): v${newVersion}\n\n${entries.map((e) => `- ${e}`).join("\n")}`]);
  console.log(`已提交: chore(${skill}): v${newVersion}`);
}

if (!noTag) {
  if (git(["tag", "-l", tag])) fail(`tag 已存在: ${tag}`);
  git(["tag", "-a", tag, "-m", `${skill} v${newVersion}`]);
  console.log(`已打 tag: ${tag}`);
}
