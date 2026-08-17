#!/usr/bin/env node
/**
 * flow-git 初始化前的 Preflight 自检。
 *
 * 收敛 SKILL.md 的环境检查：确认当前在 git 仓库内、node 可用、记录仓库上下文。
 * 失败时以非零退出码返回，并打印 JSON 汇总供调用方解析。
 */

import { execSync } from "node:child_process";

const result = {
  ok: true,
  versions: {},
  git: {},
  errors: [],
};

function fail(message) {
  result.ok = false;
  result.errors.push(message);
}

function tryExec(cmd) {
  try {
    return execSync(cmd, {
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
  } catch {
    return null;
  }
}

// 1. node 版本
const nodeVersion = tryExec("node --version");
result.versions.node = nodeVersion;
if (!nodeVersion) fail("环境检查失败: node");

// 2. git 仓库上下文
const gitRoot = tryExec("git rev-parse --show-toplevel");
result.git.root = gitRoot;
if (!gitRoot) fail("当前不在 git 仓库内");

result.git.branch = tryExec("git branch --show-current");

console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
