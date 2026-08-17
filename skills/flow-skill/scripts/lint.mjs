#!/usr/bin/env node
/**
 * flow-skill --lint 的执行脚本：对一个或多个 SKILL.md 跑 frontmatter 校验。
 *
 * 用法：
 *   node lint.mjs <路径...> [--strict] [--json]
 *
 * 路径形态（与 skill-validator 的多技能目录约定一致）：
 *   - SKILL.md 文件本身          → 直接校验
 *   - 含 SKILL.md 的技能目录      → 校验该技能
 *   - 不含 SKILL.md 的父目录      → 扫描其一级子目录中的 <name>/SKILL.md 逐一校验
 *
 * 退出码：
 *   0 通过（可有 warning/info）；1 存在 error；3 用法错误（路径缺失或无技能可校验）。
 *   --strict 时 warning 也按 error 计。info 永不阻断。
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { parseFrontmatter } from "./lint/frontmatter.mjs";
import { lintSkill } from "./lint/rules.mjs";

const argv = process.argv.slice(2);
const strict = argv.includes("--strict");
const asJson = argv.includes("--json");
const inputs = argv.filter((a) => !a.startsWith("--"));

function usage(message) {
  console.error(`用法错误: ${message}\n  node lint.mjs <SKILL.md|技能目录|技能父目录...> [--strict] [--json]`);
  process.exit(3);
}

if (inputs.length === 0) {
  usage("未提供校验路径");
}

// ---- 收集待校验的 SKILL.md ----

function collect(input) {
  const abs = path.resolve(input);
  if (!existsSync(abs)) {
    usage(`路径不存在: ${abs}`);
  }
  if (statSync(abs).isFile()) {
    return path.basename(abs) === "SKILL.md" ? [abs] : usage(`文件不是 SKILL.md: ${abs}`);
  }
  if (existsSync(path.join(abs, "SKILL.md"))) {
    return [path.join(abs, "SKILL.md")];
  }
  // 父目录形态：只扫一级子目录。深层递归会把 zRefs、node_modules 等
  // 非技能目录卷进来，多技能仓的标准布局本来就是 skills/<name>/SKILL.md
  const found = [];
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(abs, entry.name, "SKILL.md");
    if (existsSync(candidate)) found.push(candidate);
  }
  if (found.length === 0) {
    usage(`目录及其一级子目录中都没有 SKILL.md: ${abs}`);
  }
  return found;
}

const skillFiles = [...new Set(inputs.flatMap(collect))].sort();

// ---- 逐技能校验 ----

const results = skillFiles.map((file) => {
  const parsed = parseFrontmatter(readFileSync(file, "utf8"));
  return { file, findings: lintSkill(file, parsed) };
});

const tally = { skills: results.length, error: 0, warning: 0, info: 0 };
for (const { findings } of results) {
  for (const f of findings) tally[f.severity]++;
}
tally.failed = strict ? tally.error + tally.warning : tally.error;

// ---- 输出 ----

if (asJson) {
  console.log(JSON.stringify({ ok: tally.failed === 0, strict, tally, results }, null, 2));
} else {
  const SEVERITY_LABEL = { error: "ERROR", warning: "WARN ", info: "INFO " };
  for (const { file, findings } of results) {
    if (findings.length === 0) {
      console.log(`✓ ${file}`);
      continue;
    }
    console.log(`✗ ${file}`);
    for (const f of findings) {
      console.log(`    ${file}:${f.line} [${SEVERITY_LABEL[f.severity]}] ${f.rule} ${f.message}`);
    }
  }
  console.log(
    `\n${tally.skills} 个技能：${tally.error} error / ${tally.warning} warning / ${tally.info} info` +
      (strict ? "（--strict：warning 计入失败）" : ""),
  );
}

process.exit(tally.failed === 0 ? 0 : 1);
