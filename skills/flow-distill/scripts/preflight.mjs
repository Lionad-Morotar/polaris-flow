#!/usr/bin/env node
/**
 * flow-distill 初始化前的 Preflight 自检。
 *
 * 确认提炼流程依赖的技能（get-secrets、distill-and-archive）与 node 运行时可用。
 * 依赖技能均为 ~/.claude/skills 平铺安装，按平铺路径检查。
 * 失败时以非零退出码返回，并打印 JSON 汇总供调用方解析。
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const HOME = homedir();

const REQUIRED_SKILLS = ["get-secrets", "distill-and-archive"];

const result = { ok: true, skills: {}, versions: {}, errors: [] };

function fail(message) {
  result.ok = false;
  result.errors.push(message);
}

for (const skill of REQUIRED_SKILLS) {
  const skillPath = path.join(HOME, ".claude", "skills", skill, "SKILL.md");
  result.skills[skill] = existsSync(skillPath);
  if (!result.skills[skill]) fail(`缺失依赖 skill: ${skill}`);
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
