#!/usr/bin/env node
/**
 * flow-dev 收尾 Postflight 守门。
 *
 * 对仗 preflight.mjs：preflight 管「开局环境能不能跑」，postflight 管「收尾能不能
 * 清理」。worktree 模式下产物目录(docs/ 八子目录)被 git 忽略,worktree remove 对
 * ignored 文件静默连带删除——产物接回靠文档叙述曾发生漏执行致产物丢失,故收敛为
 * 机器校验:绿了才允许清理 worktree。
 *
 * 用法:
 *   node postflight.mjs <task-slug> [--apply]
 *
 * --apply:先执行产物接回(幂等复制 slug 命中的产物到 repo-root)再校验;
 * 缺省纯校验(check-only)。非 worktree 运行(flags.worktree=false)时产物与提交
 * 检查自动退化为「产物已在 repo-root」存在性自查。
 *
 * 输出:单行 JSON(失败清单只列 slug 命中项,不 dump 目录全量),exit 0/1。
 */

import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const ARTIFACT_DIRS = [
  "thoughts",
  "dissections",
  "decisions",
  "plans",
  "tdd",
  "qa",
  "reports",
  "reviews",
];

// 收尾允许的状态;中段状态说明 run 未完成,清理 worktree 会丢未固化工作
const CLOSABLE_PHASES = ["reporting", "merging", "done", "blocked", "merge-conflict"];

function fail(msg) {
  console.error(`postflight: ${msg}`);
  process.exit(2);
}

const slug = process.argv.find((a, i) => i > 1 && !a.startsWith("--"));
if (!slug) fail("缺 task-slug 参数");
const apply = process.argv.includes("--apply");
const runDir = path.join(homedir(), ".flow-dev", "runs", slug);
const statePath = path.join(runDir, "state.json");
if (!existsSync(statePath)) fail(`state.json 不存在: ${statePath}`);
const state = JSON.parse(readFileSync(statePath, "utf-8"));

const repoRoot = state.repo_root;
const workingDir = state.working_dir ?? state.repo_root;
if (!repoRoot || !existsSync(repoRoot)) fail("state.json 缺 repo_root 或路径不存在");

const result = {
  ok: true,
  slug,
  applied: apply,
  checks: {},
  failures: [],
};
function bad(check, msg) {
  result.ok = false;
  result.failures.push(`[${check}] ${msg}`);
}

const sha256 = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");

/** 收集 dir 下本 run 的产物文件(reviews 为 <slug>-* 目录内单层枚举,其余为 <slug>* 文件) */
function collectArtifacts(baseDir) {
  const out = [];
  for (const sub of ARTIFACT_DIRS) {
    const dir = path.join(baseDir, "docs", sub);
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir)) {
      if (sub === "reviews") {
        if (!entry.startsWith(`${slug}-`)) continue;
        const subDir = path.join(dir, entry);
        if (!statSync(subDir).isDirectory()) continue;
        for (const f of readdirSync(subDir)) {
          const fp = path.join(subDir, f);
          if (statSync(fp).isFile()) out.push(fp);
        }
      } else if (entry.startsWith(slug)) {
        const fp = path.join(dir, entry);
        if (statSync(fp).isFile()) out.push(fp);
      }
    }
  }
  return out;
}

// worktree 清理后复跑属于审计场景:working_dir 已不存在,git 命令落回 repo_root 执行,
// 产物接回与工作区残留检查随之退化(worktree 没了即已清理,产物比对无源可核)
const worktreeGone = workingDir !== repoRoot && !existsSync(workingDir);
const gitCwd = worktreeGone ? repoRoot : workingDir;

// 1. 产物接回校验(worktree 模式;非 worktree 时 workingDir===repoRoot,同源恒等)
const wtArtifacts = worktreeGone ? [] : collectArtifacts(workingDir);
const artifacts = { found: wtArtifacts.length, copied: 0, missing: [], mismatched: [] };
if (worktreeGone) {
  // 源已随 worktree 删除,sha256 比对无源可核——但绿灯必须能区分「已接回」与
  // 「从未接回已丢失」,否则事故已发生时审计复跑给出误导性安全信号(有前科)。
  // 降级为主仓侧存在性自查,期望清单从 state 推导(outputs 可能未回填,不可单靠):
  const expected = new Set();
  // outputs.*_path 非空项(覆盖 full 模式 thoughts/prd 等落档产物)
  for (const p of Object.values(state.outputs ?? {})) {
    if (!p) continue;
    expected.add(
      path.isAbsolute(p) && !path.relative(workingDir, p).startsWith("..")
        ? path.relative(workingDir, p)
        : p,
    );
  }
  // 报告恒落档(fix 模式除外;blocked 可能未过 reporting 不纳入期望)
  if (state.mode !== "fix" && ["reporting", "merging", "done", "merge-conflict"].includes(state.phase)) {
    expected.add(`docs/reports/${slug}.md`);
  }
  for (const rel of expected) {
    if (!existsSync(path.join(repoRoot, rel))) artifacts.missing.push(rel);
  }
  // 成功的外部审查检查点应有产物目录且非空
  const reviewSlugs = new Set();
  for (const r of state.reviews ?? []) {
    if (r.reviews?.some((m) => m.status === "success")) reviewSlugs.add(r.slug);
  }
  for (const rs of reviewSlugs) {
    const dir = path.join(repoRoot, "docs", "reviews", rs);
    const hasFile =
      existsSync(dir) && readdirSync(dir).some((f) => statSync(path.join(dir, f)).isFile());
    if (!hasFile) artifacts.missing.push(`docs/reviews/${rs}/`);
  }
  artifacts.skipped = "working_dir 已清理,降级为主仓侧产物存在性自查";
  artifacts.expected = expected.size + reviewSlugs.size;
}
for (const src of wtArtifacts) {
  const rel = path.relative(workingDir, src);
  const dest = path.join(repoRoot, rel);
  if (apply && workingDir !== repoRoot) {
    mkdirSync(path.dirname(dest), { recursive: true });
    cpSync(src, dest);
    artifacts.copied++;
  }
  if (!existsSync(dest)) {
    artifacts.missing.push(rel);
  } else if (sha256(src) !== sha256(dest)) {
    artifacts.mismatched.push(rel);
  }
}
for (const rel of artifacts.missing) bad("artifacts", `主仓缺失: ${rel}`);
for (const rel of artifacts.mismatched) bad("artifacts", `内容不一致: ${rel}`);
result.checks.artifacts = artifacts;

// 2. Slice 提交收口:done 切片的 commits 必须在当前 HEAD 祖先链上(--stage 无提交,跳过)
const commits = { verified: 0, missing_ancestor: [], done_without_commits: [] };
if (state.flags?.stage) {
  commits.skipped = "--stage 无已提交改动";
} else {
  for (const slice of state.slices ?? []) {
    if (slice.status !== "done") continue;
    if (!slice.commits?.length) {
      commits.done_without_commits.push(slice.name);
      continue;
    }
    for (const c of slice.commits) {
      try {
        execSync(`git merge-base --is-ancestor ${c.hash} HEAD`, {
          cwd: gitCwd,
          stdio: ["ignore", "pipe", "pipe"],
        });
        commits.verified++;
      } catch {
        commits.missing_ancestor.push(`${slice.name}: ${c.hash}`);
      }
    }
  }
}
for (const item of commits.missing_ancestor) bad("commits", `提交不在 HEAD 祖先链: ${item}`);
for (const name of commits.done_without_commits) bad("commits", `done 切片无 commit 记录: ${name}`);
result.checks.commits = commits;

// 3. 工作区残留(ignored 产物不在 porcelain 输出,与检查 1 互补不重叠)
// worktree 已删时无工作区可言,跳过
let dirty = [];
if (worktreeGone) {
  result.checks.workspace = { skipped: "working_dir 已清理" };
} else {
  try {
    dirty = execSync("git status --porcelain", {
      cwd: gitCwd,
      encoding: "utf-8",
    })
      .split("\n")
      .filter(Boolean);
  } catch {
    bad("workspace", "git status 执行失败");
  }
  if (dirty.length) bad("workspace", `工作区残留 ${dirty.length} 项(首项: ${dirty[0]})`);
  result.checks.workspace = { dirty_count: dirty.length, first: dirty[0] ?? null };
}

// 4. phase 可收尾性
if (!CLOSABLE_PHASES.includes(state.phase)) {
  bad("phase", `当前 phase=${state.phase} 不在可收尾集合(${CLOSABLE_PHASES.join("/")})`);
}
result.checks.phase = state.phase;

console.log(JSON.stringify(result));
process.exit(result.ok ? 0 : 1);
