/**
 * scan.mjs e2e 规格:以真实 git fixture 仓 + 真实 gitleaks 验证
 * pre-push 扫描的阻断/放行语义。无 gitleaks 的机器整组 skip。
 */

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { copyFileSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { runPrePush } from "./scan.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const ZERO = "0".repeat(40);
const hasGitleaks = spawnSync("gitleaks", ["version"]).status === 0;
const urlsafe = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const rand = (n) => Array.from(randomBytes(n)).map((b) => urlsafe[b % urlsafe.length]).join("");

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

// 仓对:work(工作仓,带仓级扫描配置与一个干净初始 commit)
// 配置随仓走是被测契约的一部分,fixture 必须复刻真实布局
function makeWork(t, { withBlacklist = false } = {}) {
  const work = mkdtempSync(path.join(tmpdir(), "pp-work-"));
  t.after(() => rmSync(work, { recursive: true, force: true }));
  mkdirSync(path.join(work, ".githooks"), { recursive: true });
  copyFileSync(
    path.join(REPO_ROOT, ".githooks", "gitleaks.toml"),
    path.join(work, ".githooks", "gitleaks.toml"),
  );
  if (withBlacklist) {
    mkdirSync(path.join(work, "configs"), { recursive: true });
    writeFileSync(path.join(work, "configs", "secret-scan.local.txt"), "internal-example-corp.com\n");
  }
  git(work, ["init", "-q", "-b", "main", "."]);
  git(work, ["config", "user.email", "t@t.t"]);
  git(work, ["config", "user.name", "t"]);
  writeFileSync(path.join(work, "a.txt"), "clean\n");
  git(work, ["add", "."]);
  git(work, ["commit", "-qm", "init"]);
  return work;
}

function commitFile(work, rel, content, message) {
  mkdirSync(path.dirname(path.join(work, rel)), { recursive: true });
  writeFileSync(path.join(work, rel), content);
  git(work, ["add", "-f", rel]);
  git(work, ["commit", "-qm", message]);
  return git(work, ["rev-parse", "HEAD"]);
}

function head(work) {
  return git(work, ["rev-parse", "HEAD"]);
}

function stdinLine(localSha, remoteSha) {
  return `refs/heads/main ${localSha} refs/heads/main ${remoteSha}\n`;
}

function run(work, stdinText, opts = {}) {
  return runPrePush({ stdinText, repoDir: work, ...opts });
}

test("干净推送放行", { skip: !hasGitleaks && "gitleaks 未安装" }, (t) => {
  const work = makeWork(t);
  const base = head(work);
  const tip = commitFile(work, "b.txt", "more clean\n", "clean work");
  const r = run(work, stdinLine(tip, base));
  assert.equal(r.blocked, false, JSON.stringify(r, null, 2));
});

test("脏 commit(sk-ant)被阻断并报出规则与文件", { skip: !hasGitleaks && "gitleaks 未安装" }, (t) => {
  const work = makeWork(t);
  const base = head(work);
  const tip = commitFile(work, "leak.txt", `sk-ant-api03-${rand(68)}\n`, "add key");
  const r = run(work, stdinLine(tip, base));
  assert.equal(r.blocked, true);
  assert.ok(r.findings.some((f) => f.RuleID === "anthropic-api-key" && f.File === "leak.txt"));
});

test("先加后删同一次推送仍被阻断(逐 commit 扫描,非净差)", { skip: !hasGitleaks && "gitleaks 未安装" }, (t) => {
  const work = makeWork(t);
  const base = head(work);
  commitFile(work, "leak.txt", `sk-ant-api03-${rand(68)}\n`, "add key");
  git(work, ["rm", "-q", "leak.txt"]);
  git(work, ["commit", "-qm", "remove key"]);
  const r = run(work, stdinLine(head(work), base));
  assert.equal(r.blocked, true, "历史中出现过的秘钥必须拦截");
});

test("merge commit 独占引入的秘钥被阻断(-m 覆盖)", { skip: !hasGitleaks && "gitleaks 未安装" }, (t) => {
  const work = makeWork(t);
  const base = head(work);
  git(work, ["checkout", "-qb", "side"]);
  commitFile(work, "side.txt", "clean side\n", "side work");
  git(work, ["checkout", "-q", "main"]);
  commitFile(work, "main.txt", "clean main\n", "main work");
  git(work, ["merge", "--no-ff", "side", "-qm", "merge"]);
  // 秘钥只在 merge commit 自身的 diff 中出现(任一父都没有)
  writeFileSync(path.join(work, "merge-secret.txt"), `sk-ant-api03-${rand(68)}\n`);
  git(work, ["add", "merge-secret.txt"]);
  git(work, ["commit", "-q", "--amend", "--no-edit"]);
  const r = run(work, stdinLine(head(work), base));
  assert.equal(r.blocked, true, "merge 独占引入的秘钥必须拦截");
});

test("新 ref 推送:--not --remotes 只扫新增 commit", { skip: !hasGitleaks && "gitleaks 未安装" }, (t) => {
  const work = makeWork(t);
  // 模拟主干历史已在远端:配置一个 remote 并建立 remote-tracking ref
  const remote = mkdtempSync(path.join(tmpdir(), "pp-remote-"));
  t.after(() => rmSync(remote, { recursive: true, force: true }));
  git(remote, ["init", "-q", "--bare", "."]);
  git(work, ["remote", "add", "origin", remote]);
  git(work, ["push", "-q", "origin", "main"]);
  // 新分支:干净新 commit → 放行(既有历史不重扫)
  git(work, ["checkout", "-qb", "feat"]);
  const tip = commitFile(work, "feat.txt", "clean feature\n", "feat");
  const r = run(work, stdinLine(tip, ZERO));
  assert.equal(r.blocked, false, JSON.stringify(r, null, 2));
  // 新分支带脏 commit → 阻断
  commitFile(work, "leak.txt", `sk-ant-api03-${rand(68)}\n`, "dirty feat");
  const r2 = run(work, stdinLine(head(work), ZERO));
  assert.equal(r2.blocked, true);
});

test("删除 ref 跳过扫描", { skip: !hasGitleaks && "gitleaks 未安装" }, (t) => {
  const work = makeWork(t);
  // 历史里埋一个脏 commit;删除 ref 的 stdin 不应触发任何扫描
  commitFile(work, "leak.txt", `sk-ant-api03-${rand(68)}\n`, "dirty");
  const r = run(work, stdinLine(ZERO, head(work)));
  assert.equal(r.blocked, false);
  assert.equal(r.findings.length, 0);
});

test("禁止路径:git add -f 强塞的本机黑名单文件被阻断", { skip: !hasGitleaks && "gitleaks 未安装" }, (t) => {
  const work = makeWork(t);
  const base = head(work);
  commitFile(work, "configs/secret-scan.local.txt", "topsecret\n", "force-add local blacklist");
  const r = run(work, stdinLine(head(work), base));
  assert.equal(r.blocked, true);
  assert.ok(r.forbidden.some((h) => h.rule === "repo-local-configs" && h.path === "configs/secret-scan.local.txt"));
});

test("本机黑名单字面量经合并配置端到端生效", { skip: !hasGitleaks && "gitleaks 未安装" }, (t) => {
  const work = makeWork(t, { withBlacklist: true });
  const base = head(work);
  commitFile(work, "site.txt", "internal-example-corp.com\n", "internal site");
  const r = run(work, stdinLine(head(work), base));
  assert.equal(r.blocked, true);
  assert.ok(r.findings.some((f) => f.RuleID === "local-blacklist"));
});

test("gitleaks 缺失时 fail-closed 并给出安装指引", (t) => {
  const work = makeWork(t);
  const r = run(work, stdinLine(head(work), head(work)), { gitleaksBin: "gitleaks-bin-不存在" });
  assert.equal(r.blocked, true);
  assert.equal(r.errors[0].kind, "gitleaks-missing");
});

test("CLI 接线:stdin 驱动,脏推 exit 1、干净 exit 0", { skip: !hasGitleaks && "gitleaks 未安装" }, (t) => {
  const work = makeWork(t);
  const base = head(work);
  const scan = path.join(HERE, "scan.mjs");
  const clean = spawnSync(process.execPath, [scan, work], { input: stdinLine(head(work), base), encoding: "utf8" });
  assert.equal(clean.status, 0, clean.stderr);
  commitFile(work, "leak.txt", `sk-ant-api03-${rand(68)}\n`, "dirty");
  const dirty = spawnSync(process.execPath, [scan, work], { input: stdinLine(head(work), base), encoding: "utf8" });
  assert.equal(dirty.status, 1);
  assert.ok(dirty.stderr.includes("anthropic-api-key"));
});
