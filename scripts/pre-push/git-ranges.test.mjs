/**
 * git-ranges 行为规格:pre-push stdin 协议解析与扫描范围推导。
 * 协议:stdin 每行一个 ref 更新 `<local ref> <local sha> <remote ref> <remote sha>`。
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { logOptsForUpdate, parsePrePushStdin } from "./git-ranges.mjs";

const ZERO = "0".repeat(40);
const A = "a".repeat(40);
const B = "b".repeat(40);

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

// 夹具:两个提交的仓库,返回 { root, c1, c2 }
function setupRepo(t) {
  const root = mkdtempSync(path.join(tmpdir(), "git-ranges-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, "init", "-q", ".");
  git(root, "config", "user.email", "t@t.t");
  git(root, "config", "user.name", "t");
  writeFileSync(path.join(root, "a.txt"), "1\n");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "c1");
  const c1 = git(root, "rev-parse", "HEAD").trim();
  writeFileSync(path.join(root, "a.txt"), "2\n");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "c2");
  const c2 = git(root, "rev-parse", "HEAD").trim();
  return { root, c1, c2 };
}

test("parsePrePushStdin 解析多行 ref 更新", () => {
  const stdin = `refs/heads/main ${A} refs/heads/main ${B}\nrefs/heads/feat ${A} refs/heads/feat ${ZERO}\n`;
  const updates = parsePrePushStdin(stdin);
  assert.equal(updates.length, 2);
  assert.deepEqual(updates[0], {
    localRef: "refs/heads/main",
    localSha: A,
    remoteRef: "refs/heads/main",
    remoteSha: B,
  });
});

test("parsePrePushStdin 空输入与末尾空行", () => {
  assert.deepEqual(parsePrePushStdin(""), []);
  assert.deepEqual(parsePrePushStdin("\n"), []);
});

test("logOptsForUpdate 常规更新:remote..local 范围,带 -m 覆盖 merge diff", (t) => {
  const { root, c1, c2 } = setupRepo(t);
  const opts = logOptsForUpdate(root, { localRef: "r", localSha: c2, remoteRef: "r", remoteSha: c1 });
  assert.equal(opts, `-m ${c1}..${c2}`);
});

test("logOptsForUpdate 新 ref(remote 全零):排除所有远端已有 commit", (t) => {
  // 新分支常从既有 main 岔出,--not --remotes 保证只扫真正新增的 commit
  const { root, c2 } = setupRepo(t);
  const opts = logOptsForUpdate(root, { localRef: "r", localSha: c2, remoteRef: "r", remoteSha: ZERO });
  assert.equal(opts, `-m ${c2} --not --remotes`);
});

test("logOptsForUpdate 删除 ref(local 全零):返回 null 不扫描", (t) => {
  const { root, c1 } = setupRepo(t);
  const opts = logOptsForUpdate(root, { localRef: "r", localSha: ZERO, remoteRef: "r", remoteSha: c1 });
  assert.equal(opts, null);
});

test("logOptsForUpdate 历史重写后 force-push:remote 旧 sha 已被 gc,回退扫 local 全部可达历史", (t) => {
  // filter-repo 重写 + gc 后,远端旧 sha 在本地不再是合法对象,
  // remote..local 会是非法 revision range;必须回退而非构造出坏范围
  const { root, c2 } = setupRepo(t);
  const goneRemote = "c".repeat(40);
  const opts = logOptsForUpdate(root, { localRef: "r", localSha: c2, remoteRef: "r", remoteSha: goneRemote });
  assert.equal(opts, `-m ${c2} --not --remotes`);
});
