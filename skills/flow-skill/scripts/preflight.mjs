#!/usr/bin/env node
/**
 * flow-skill 初始化前的 Preflight 自检，以 --mode 分流（当前仅 create 一条分支）：
 *
 * - create：创建新技能。确认 node 可用；部署目录 ~/.claude/skills 存在且可写
 *   （所有技能最终符号链接到此处才被 Claude Code 加载，属环境固定事实，失败即阻断）。
 *   --input 给定时校验技能名合法性（kebab-case）；--target 给定时校验目标目录存在。
 *   同名碰撞只告警不阻断：碰撞后「并入既有技能还是改名新建」是业务决策，
 *   由 Workflow A Step 0 询问用户，脚本层只负责把碰撞路径列进 JSON 的 collisions[]。
 *   这与 flow-search preflight 的分工一致——输入合法性属事实校验（阻断），
 *   语义冲突属业务决策（告警 + 移交 workflow）。
 *
 * 未来新增模式（如 --review / --retire）时按 flow-search 的多 mode 结构扩展 runXxx()，
 * 不做 union 校验，避免一个模式的输入启发式误杀另一个模式。
 *
 * 失败时以非零退出码返回，并打印 JSON 汇总供调用方解析。
 */

import { accessSync, constants, existsSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// ---- 参数解析 ----

const argv = process.argv.slice(2);
function argValue(flag) {
  const i = argv.indexOf(flag);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}

const mode = argValue("--mode") ?? "create";
if (mode !== "create") {
  console.log(
    JSON.stringify({ ok: false, mode, errors: [`未知 --mode: ${mode}（当前仅支持 create）`] }, null, 2),
  );
  process.exit(1);
}

function finish(result) {
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

// 技能根：碰撞扫描的已知落点（环境固定事实，与 references/create-skill.md 归属决策树一致）
const HOME = os.homedir();
const SKILL_ROOTS = [
  { name: "personal", label: "个人技能目录", dir: path.join(HOME, ".claude", "skills") },
  { name: "standalone", label: "独立技能目录", dir: path.join(HOME, "Github", "Local", "local-link", "skills") },
  { name: "flow", label: "flow 子模块", dir: path.join(HOME, "Github", "Local", "local-link", "skills", "flow", "skills") },
];

const NAME_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

// ---- create 模式 ----

function runCreate() {
  const result = {
    ok: true,
    mode: "create",
    versions: {},
    deploy: {},
    input: {},
    target: {},
    collisions: [],
    warnings: [],
    errors: [],
  };

  const fail = (message) => {
    result.ok = false;
    result.errors.push(message);
  };
  const warn = (message) => result.warnings.push(message);

  // 1. node（自检能跑到这里说明 node 可用，版本号用于 JSON 归档）
  result.versions.node = process.version;

  // 2. 部署目录：所有技能的最终加载入口，缺失或不可写则创建出来也无法部署
  const deployDir = path.join(HOME, ".claude", "skills");
  result.deploy.dir = deployDir;
  if (!existsSync(deployDir)) {
    fail(`部署目录不存在: ${deployDir}`);
  } else {
    try {
      accessSync(deployDir, constants.W_OK);
      result.deploy.writable = true;
    } catch {
      result.deploy.writable = false;
      fail(`部署目录不可写: ${deployDir}`);
    }
  }

  // 3. 技能名：可选。给了就必须是 kebab-case（目录名即技能名，非法字符会破坏链接与触发）；
  //    未给不阻断——需求 gathering 阶段会交互式确定名称
  const input = argValue("--input");
  if (!input) {
    result.input.kind = "none";
    warn("未收到 --input，将在需求 gathering 阶段确定技能名");
  } else if (!NAME_RE.test(input)) {
    result.input.kind = "invalid";
    result.input.value = input;
    fail(`技能名不是合法 kebab-case（小写字母开头，仅含小写字母/数字/连字符）: ${input}`);
  } else {
    result.input.kind = "name";
    result.input.value = input;
  }

  // 4. 目标目录：可选。给了就必须是已存在目录（创建动作发生在 workflow 内，preflight 不代劳）
  const target = argValue("--target");
  if (target) {
    const abs = path.resolve(target);
    result.target.dir = abs;
    if (!existsSync(abs)) {
      fail(`目标目录不存在: ${abs}`);
    } else if (!statSync(abs).isDirectory()) {
      fail(`目标路径不是目录: ${abs}`);
    } else {
      result.target.exists = true;
    }
  }

  // 5. 同名碰撞扫描：三个技能根逐一探测。碰撞是业务决策（并入 vs 新建），
  //    只进 collisions[] 与 warnings，不改 ok——阻断会挡住「确实要重建」的合法路径
  if (result.input.kind === "name") {
    for (const root of SKILL_ROOTS) {
      const candidate = path.join(root.dir, input);
      if (existsSync(candidate)) {
        result.collisions.push({ root: root.name, label: root.label, path: candidate });
      }
    }
    if (result.collisions.length > 0) {
      warn(
        `发现 ${result.collisions.length} 处同名技能：` +
          result.collisions.map((c) => `${c.label}(${c.path})`).join("、") +
          "。并入还是改名新建由 Workflow A Step 0 询问用户。",
      );
    }
  }

  finish(result);
}

runCreate();
