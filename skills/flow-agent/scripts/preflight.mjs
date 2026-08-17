#!/usr/bin/env node
/**
 * flow-agent 初始化前的 Preflight 自检。
 *
 * 按 configs/launchers.json 的 models 表按族检查启动器（唯一事实源，本机私有、
 * 不入库；模板见 configs/launchers.example.json）：
 * 族内任一可用即该族通过（preflight 不比运行时更严——降级链的意义就是
 * 冗余容错，逐个点名必需会让 preflight 比实际执行更容易失败，从保障变成
 * 误报源）；全族覆没才判定失败。
 *
 * zsh function 检测统一 `zsh -c 'source ~/.zshrc 2>/dev/null; ...'`。
 * 不用 `zsh -ic`——交互模式在无 TTY 子进程里触发 powerlevel10k gitstatus
 * 初始化失败（实测报 can't change option: monitor），stderr 噪音之外
 * 还可能致 function 加载不全、误报缺失。
 *
 * 失败时以非零退出码返回，并打印 JSON 汇总供调用方（flow-dev 等）解析合并。
 */

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// 技能目录即 SKILL.md 所在目录；symlink 部署下 readFileSync 自动跟随，无需 realpath
const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * 读取自身 SKILL.md frontmatter 的 metadata.version。
 * 该值是 state.json 打标与 resume 漂移判定的机器契约，由 bump.mjs 维护；
 * 解析失败返回 null 而非报错——版本缺失不该阻断环境自检。
 */
function readSkillVersion() {
  try {
    const text = readFileSync(path.join(SKILL_DIR, "SKILL.md"), "utf-8");
    const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
    if (!fm) return null;
    const lines = fm[1].split(/\r?\n/);
    const metaIdx = lines.findIndex((l) => /^metadata\s*:/.test(l) && !/^\s/.test(l));
    if (metaIdx < 0) return null;
    for (let i = metaIdx + 1; i < lines.length && /^\s+\S/.test(lines[i]); i++) {
      const v = /^\s+version\s*:\s*"?([^"\s]+)"?\s*$/.exec(lines[i]);
      if (v) return v[1];
    }
    return null;
  } catch {
    return null;
  }
}

// 模型→启动器族清单来自 configs/launchers.json（本机配置，不随仓分发）；
// 缺失或非法时按环境不就绪处理，报错指向 example 模板
const LAUNCHERS_CONFIG_PATH = path.join(SKILL_DIR, "configs", "launchers.json");

function loadLauncherFamilies() {
  try {
    const models = JSON.parse(readFileSync(LAUNCHERS_CONFIG_PATH, "utf-8"))?.models;
    if (!models || typeof models !== "object") return null;
    const families = {};
    for (const [model, cfg] of Object.entries(models)) {
      if (!Array.isArray(cfg?.launchers) || cfg.launchers.length === 0) return null;
      families[model] = cfg.launchers;
    }
    return families;
  } catch {
    return null;
  }
}

const LAUNCHER_FAMILIES = loadLauncherFamilies();

const result = { ok: true, skill_version: readSkillVersion(), families: {}, versions: {}, errors: [] };

function fail(message) {
  result.ok = false;
  result.errors.push(message);
}

function tryExec(cmd) {
  try {
    return execSync(cmd, {
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf-8",
      timeout: 8000,
    }).trim();
  } catch {
    return null;
  }
}

// 1. 运行时：node（本脚本与编排逻辑）、python3（run-external-review.py）
result.versions.node = tryExec("node --version");
if (!result.versions.node) fail("环境检查失败: node");
result.versions.python3 = tryExec("python3 --version");
if (!result.versions.python3) {
  fail("环境检查失败: python3（run-external-review.py 运行时）");
}

// 2. 启动器族：单次 zsh 内批量 command -v，避免逐族 spawn + source 的开销
if (!LAUNCHER_FAMILIES) {
  fail(
    `本机启动器配置缺失或非法: ${LAUNCHERS_CONFIG_PATH}（复制 configs/launchers.example.json 填写）`,
  );
  console.log(JSON.stringify(result, null, 2));
  process.exit(1);
}
const allLaunchers = [...new Set(Object.values(LAUNCHER_FAMILIES).flat())];
const probe = tryExec(
  `zsh -c 'source ~/.zshrc 2>/dev/null; for c in ${allLaunchers.join(" ")}; do command -v "$c" >/dev/null 2>&1 && echo "$c:1" || echo "$c:0"; done'`,
);

if (!probe) {
  fail("zsh profile 加载失败：无法执行批量启动器探测");
} else {
  const avail = new Map(
    probe
      .split("\n")
      .map((line) => line.split(":"))
      .filter(([name]) => name)
      .map(([name, flag]) => [name, flag === "1"]),
  );
  for (const [model, launchers] of Object.entries(LAUNCHER_FAMILIES)) {
    const active = launchers.find((l) => avail.get(l) === true) ?? null;
    result.families[model] = {
      ok: active !== null,
      active,
      unavailable: launchers.filter((l) => avail.get(l) !== true),
    };
    if (!active) {
      fail(`启动器全族不可用: ${model}（${launchers.join(" / ")}）`);
    }
  }
}

console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
