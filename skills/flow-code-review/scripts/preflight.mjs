#!/usr/bin/env node
/**
 * flow-code-review 初始化前的 Preflight 自检。
 *
 * 本技能自包含（不依赖其他 skill），只需确认 git/node 运行时与 git 仓库上下文。
 * gh 为可选依赖：target 为 PR 号时才需要，缺失仅告警不阻断。
 * 失败时以非零退出码返回，并打印 JSON 汇总供调用方解析。
 */

import { execSync } from "node:child_process";

const result = { ok: true, versions: {}, optional: {}, warnings: [], errors: [] };

function check(name, cmd, { optional = false } = {}) {
  try {
    const output = execSync(cmd, {
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
    (optional ? result.optional : result.versions)[name] = output;
  } catch {
    (optional ? result.optional : result.versions)[name] = null;
    if (optional) {
      result.warnings.push(`可选依赖缺失: ${name}（PR 号目标不可用）`);
    } else {
      result.ok = false;
      result.errors.push(`环境检查失败: ${name}`);
    }
  }
}

check("node", "node --version");
check("git", "git --version");
check("git_root", "git rev-parse --show-toplevel");
check("gh", "gh --version", { optional: true });

console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
