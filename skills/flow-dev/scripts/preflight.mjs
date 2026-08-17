#!/usr/bin/env node
/**
 * flow-dev 初始化前的 Preflight 自检。
 *
 * 把 SKILL.md 中冗长的依赖检查清单收敛成本脚本，避免主流程被细节淹没。
 * 失败时以非零退出码返回，并打印 JSON 汇总供调用方解析。
 *
 * 外部审查依赖 flow-agent runner 技能（正交审查调度器，见 flow-agent/SKILL.md，
 * 按 external-review-protocol.md 契约实现）。启动器按族检查委托 runner 的 preflight（若提供）：
 * 降级链清单的真相源在 runner 侧，本脚本不再维护启动器清单——双份维护必然漂移。
 * runner 未提供 preflight 脚本时按族检查跳过（极简 runner 无降级链概念，不算错误）。
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HOME = homedir();

// 技能目录即 SKILL.md 所在目录；symlink 部署下 readFileSync 自动跟随，无需 realpath
const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * 读取指定 SKILL.md frontmatter 的 metadata.version。
 * 该值是 state.json 打标与 resume 漂移判定的机器契约，由 bump.mjs 维护；
 * 返回 null 表示技能未版本化（如 grill-me/tdd 等仓外技能），不视为错误。
 */
function readSkillVersion(skillFile) {
  try {
    const text = readFileSync(skillFile, "utf-8");
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

// flow-dev 强依赖的周边 skill（flow-agent 为外部审查 runner 技能）
const REQUIRED_SKILLS = [
  "grill-me",
  "tdd",
  "flow-code-review",
  "flow-agent",
];

// 仅 --mode full 依赖的 skill：--mode light 跳过 to-prd，不生成 PRD
const FULL_ONLY_SKILLS = ["to-prd"];

// --mode dev 跳过 Step 1（UltraThoughts / 拆解）与 Step 2（grill-me / PRD），
// 不需要 grill-me 和 to-prd，但仍需 tdd、code-review、flow-agent（code-review 检查点）
// --mode quick 保留 Step 1（UltraThoughts 是 flow-dev 自身能力、不依赖额外 skill）但跳过 Step 2（grill-me），
// 依赖集与 dev 一致；依赖集跟「实际执行的 Step」走，而非落档行为
const DEV_SKILLS = ["tdd", "flow-code-review", "flow-agent"];

// --mode fix 在 dev 基础上恒禁用 Step 6 外部正交审查，不再依赖 runner；
// 保留 Step 5 本地 code-review 与 Step 3/7 的 tdd 流程
const FIX_SKILLS = ["tdd", "flow-code-review"];

// --mode <light|full|quick|dev|fix>：省略时按 light 处理。非法值直接 fail，
// 避免把拼写错误静默当成 light 而漏检 full 依赖
const VALID_MODES = ["light", "full", "quick", "dev", "fix"];
const modeArgIndex = process.argv.indexOf("--mode");
const mode = modeArgIndex === -1 ? "light" : process.argv[modeArgIndex + 1];

const requiredSkills =
  mode === "full"
    ? [...REQUIRED_SKILLS, ...FULL_ONLY_SKILLS]
    : mode === "fix"
      ? FIX_SKILLS
      : mode === "dev" || mode === "quick"
        ? DEV_SKILLS
        : REQUIRED_SKILLS;

// 版本/环境检查项
const VERSION_CHECKS = [
  { name: "node", cmd: "node --version" },
  { name: "python3", cmd: "python3 --version" },
  { name: "git_root", cmd: "git rev-parse --show-toplevel" },
];

const result = {
  ok: true,
  mode,
  skill_version: readSkillVersion(path.join(SKILL_DIR, "SKILL.md")),
  skill_versions: {},
  skills: {},
  launcherFamilies: null, // 来自 runner preflight 的按族检查结果（runner 未提供时保持 null）
  versions: {},
  errors: [],
};

function fail(message) {
  result.ok = false;
  result.errors.push(message);
}

if (!VALID_MODES.includes(mode)) {
  fail(`非法 --mode: ${String(mode)}（合法值：${VALID_MODES.join("/")}）`);
}

// 1. 检查 skill 文件是否存在，并顺带读其版本（state.json 打标的数据源）
for (const skill of requiredSkills) {
  const skillPath = path.join(HOME, ".claude", "skills", skill, "SKILL.md");
  const exists = existsSync(skillPath);
  result.skills[skill] = { path: skillPath, exists };
  if (!exists) {
    fail(`缺失依赖 skill: ${skill}`);
    continue;
  }
  result.skill_versions[skill] = readSkillVersion(skillPath);
}
result.skill_versions["flow-dev"] = result.skill_version;

// 2. 启动器按族检查：spawn runner preflight 并合并其结果。
// runner 缺失时跳过（上面已报缺失，避免双重报错）；
// runner 不提供 preflight 脚本时同样跳过（极简 runner 只需能执行审查）
if (result.skills["flow-agent"]?.exists) {
  const runnerPreflight = path.join(
    HOME,
    ".claude",
    "skills",
    "flow-agent",
    "scripts",
    "preflight.mjs",
  );
  if (existsSync(runnerPreflight)) {
    try {
      // runner preflight 失败（族覆没）时退出码非零，stdout 仍含 JSON，须捕获后解析
      let stdout;
      try {
        stdout = execSync(`node ${JSON.stringify(runnerPreflight)}`, {
          stdio: ["ignore", "pipe", "pipe"],
          encoding: "utf-8",
          timeout: 15000,
        });
      } catch (err) {
        stdout = err.stdout ?? "";
      }
      const runnerResult = JSON.parse(stdout);
      result.launcherFamilies = runnerResult.families ?? null;
      if (!runnerResult.ok) {
        for (const e of runnerResult.errors ?? []) {
          fail(`flow-agent: ${e}`);
        }
      }
    } catch {
      fail("runner preflight 输出无法解析（脚本可能损坏）");
    }
  }
}

// 3. 检查运行时版本与 git 仓库上下文
for (const { name, cmd } of VERSION_CHECKS) {
  try {
    const output = execSync(cmd, {
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
    result.versions[name] = output;
  } catch (err) {
    result.versions[name] = null;
    fail(`环境检查失败: ${name}`);
  }
}

console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
