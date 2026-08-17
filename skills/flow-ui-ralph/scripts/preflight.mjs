#!/usr/bin/env node
/**
 * flow-ui-ralph 初始化前的 Preflight 自检。
 *
 * 确认 UI 还原流程依赖的技能（kimi-webbridge 浏览器截图验证）与 node 运行时可用。
 * flow-image 为适用性依赖（仅设计生成模式需要），缺失仅警告不判失败。
 * 依赖技能为 ~/.claude/skills 平铺安装，按平铺路径检查。
 * 失败时以非零退出码返回，并打印 JSON 汇总供调用方解析。
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const HOME = homedir();

const REQUIRED_SKILLS = ["kimi-webbridge"];

// 设计生成模式(references/design-generation.md)依赖 flow-image 生成目标素材,
// 但还原模式不需要——缺失仅警告不判失败
const OPTIONAL_SKILLS = ["flow-image"];

const result = { ok: true, skills: {}, versions: {}, warnings: [], errors: [] };

function fail(message) {
  result.ok = false;
  result.errors.push(message);
}

for (const skill of REQUIRED_SKILLS) {
  const skillPath = path.join(HOME, ".claude", "skills", skill, "SKILL.md");
  result.skills[skill] = existsSync(skillPath);
  if (!result.skills[skill]) fail(`缺失依赖 skill: ${skill}`);
}

for (const skill of OPTIONAL_SKILLS) {
  const skillPath = path.join(HOME, ".claude", "skills", skill, "SKILL.md");
  result.skills[skill] = existsSync(skillPath);
  if (!result.skills[skill]) {
    result.warnings.push(`缺失可选 skill: ${skill}(设计生成模式不可用,还原模式不受影响)`);
  }
}

try {
  result.versions.node = execSync("node --version", {
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf-8",
    timeout: 5000,
  }).trim();
} catch {
  result.versions.node = null;
  fail("环境检查失败: node");
}

console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
