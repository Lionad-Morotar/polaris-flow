/**
 * .githooks/pre-push 挂载 e2e:真实 git push 驱动,验证
 * hook 经 core.hooksPath 挂载后的端到端阻断/放行/绕过语义。
 */

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, copyFileSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const hasGitleaks = spawnSync("gitleaks", ["version"]).status === 0;
const urlsafe = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const rand = (n) => Array.from(randomBytes(n)).map((b) => urlsafe[b % urlsafe.length]).join("");

const RUNTIME_FILES = [
  [".githooks/pre-push", 0o755],
  [".githooks/gitleaks.toml"],
  ["scripts/pre-push/scan.mjs"],
  ["scripts/pre-push/git-ranges.mjs"],
  ["scripts/pre-push/forbidden-paths.mjs"],
  ["scripts/pre-push/merge-config.mjs"],
];

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

// 复刻仓的真实 hook 布局:tracked 运行时文件拷入 fixture,core.hooksPath 挂载
function makePair(t) {
  const root = mkdtempSync(path.join(tmpdir(), "hook-e2e-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const remote = path.join(root, "remote.git");
  const work = path.join(root, "work");
  git(root, ["init", "-q", "--bare", "remote.git"]);
  git(root, ["init", "-q", "-b", "main", "work"]);
  git(work, ["config", "user.email", "t@t.t"]);
  git(work, ["config", "user.name", "t"]);
  for (const [rel, mode] of RUNTIME_FILES) {
    mkdirSync(path.dirname(path.join(work, rel)), { recursive: true });
    copyFileSync(path.join(REPO_ROOT, rel), path.join(work, rel));
    if (mode) chmodSync(path.join(work, rel), mode);
  }
  writeFileSync(path.join(work, "a.txt"), "clean\n");
  git(work, ["add", "."]);
  git(work, ["commit", "-qm", "init"]);
  git(work, ["remote", "add", "origin", remote]);
  git(work, ["config", "core.hooksPath", ".githooks"]);
  return { work, remote };
}

function push(work, args = []) {
  return spawnSync("git", ["push", ...args], { cwd: work, encoding: "utf8" });
}

function commitFile(work, rel, content, message) {
  writeFileSync(path.join(work, rel), content);
  git(work, ["add", "-f", rel]);
  git(work, ["commit", "-qm", message]);
}

test("真实 push:干净放行、脏阻断、--no-verify 可绕过", { skip: !hasGitleaks && "gitleaks 未安装" }, (t) => {
  const { work } = makePair(t);

  const clean = push(work, ["-u", "origin", "main"]);
  assert.equal(clean.status, 0, clean.stderr);

  commitFile(work, "leak.txt", `sk-ant-api03-${rand(68)}\n`, "add key");
  const dirty = push(work, ["origin", "main"]);
  assert.notEqual(dirty.status, 0, "脏推送必须被 hook 阻断");
  assert.ok(dirty.stderr.includes("anthropic-api-key"), dirty.stderr);

  const bypass = push(work, ["--no-verify", "origin", "main"]);
  assert.equal(bypass.status, 0, `--no-verify 是显式逃生门: ${bypass.stderr}`);
});
