#!/usr/bin/env node
/**
 * flow-tour 初始化前的 Preflight 自检。
 *
 * 两层检查：
 * 1. 依赖技能（kimi-webbridge 浏览器验证）与 node 运行时
 * 2. Dev Hub 基建（tour 页挂 /dev/* 的基座，未隔离会泄漏进生产产物）——
 *    委托 flow-dx preflight 的 devHub 字段，探测逻辑单真相源在 flow-dx。
 *    Nuxt 项目且未就绪 → 失败并指引先跑 flow-dx；非 Nuxt 项目不判定
 *    （CodeTour-only 模式无此约束），仅输出信息字段。
 *
 * 失败时以非零退出码返回，并打印 JSON 汇总供调用方解析。
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const HOME = homedir();

const REQUIRED_SKILLS = ["kimi-webbridge"];

const result = { ok: true, skills: {}, devHub: null, versions: {}, errors: [] };

function fail(message) {
  result.ok = false;
  result.errors.push(message);
}

// 1. 依赖技能与运行时
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

// 2. Dev Hub 基建：spawn flow-dx preflight 取 devHub 字段
// flow-dx preflight 失败（非 git 仓库）时退出码非零，stdout 仍含 JSON，须捕获后解析
const dxPreflight = path.join(
  HOME,
  ".claude",
  "skills",
  "flow-dx",
  "scripts",
  "preflight.mjs",
);
if (!existsSync(dxPreflight)) {
  fail("缺失 flow-dx preflight（Dev Hub 探测依赖）");
} else {
  try {
    let stdout;
    try {
      stdout = execSync(`node ${JSON.stringify(dxPreflight)}`, {
        stdio: ["ignore", "pipe", "pipe"],
        encoding: "utf-8",
        timeout: 15000,
      });
    } catch (err) {
      stdout = err.stdout ?? "";
    }
    const dxResult = JSON.parse(stdout);
    if (dxResult.error) {
      fail(`flow-dx preflight: ${dxResult.error}（tour 产物须进 git）`);
    } else {
      const devHub = dxResult.devHub ?? null;
      result.devHub = devHub;
      if (devHub?.applicable && devHub.ready !== true && devHub.ready !== "skip") {
        fail("Dev Hub 基建未就绪：先跑 flow-dx 初始化（dev 页生产隔离），勿在未隔离项目建 /dev/* 页面");
      }
    }
  } catch {
    fail("flow-dx preflight 输出无法解析（脚本可能损坏）");
  }
}

console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
