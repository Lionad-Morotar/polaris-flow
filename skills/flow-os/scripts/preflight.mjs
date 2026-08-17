#!/usr/bin/env node
/**
 * flow-os 初始化前的 Preflight 自检。
 *
 * 收敛 SKILL.md 的环境检查：确认 node 可用、~/.cp/ 存在、~/.zshrc 含
 * _claude_run_with_version wrapper（启动器函数的前提）。
 * 失败时以非零退出码返回，并打印 JSON 汇总供调用方解析。
 */

import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const result = {
  ok: true,
  versions: {},
  os: {},
  errors: [],
};

function fail(message) {
  result.ok = false;
  result.errors.push(message);
}

// 1. node 版本
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

// 2. ~/.cp/ 目录与 provider 配置数量
const cpDir = join(homedir(), ".cp");
result.os.cpDir = existsSync(cpDir);
if (!result.os.cpDir) {
  fail("~/.cp/ 目录不存在");
} else {
  result.os.providerCount = readdirSync(cpDir).filter((f) =>
    f.endsWith(".json"),
  ).length;
}

// 3. ~/.zshrc 含 _claude_run_with_version wrapper
const zshrcPath = join(homedir(), ".zshrc");
result.os.zshrc = existsSync(zshrcPath);
if (!result.os.zshrc) {
  fail("~/.zshrc 不存在");
} else {
  result.os.wrapper = readFileSync(zshrcPath, "utf-8").includes(
    "_claude_run_with_version",
  );
  if (!result.os.wrapper) fail("~/.zshrc 缺少 _claude_run_with_version wrapper");
}

console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
