/**
 * git-ranges 行为规格:pre-push stdin 协议解析与扫描范围推导。
 * 协议:stdin 每行一个 ref 更新 `<local ref> <local sha> <remote ref> <remote sha>`。
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { logOptsForUpdate, parsePrePushStdin } from "./git-ranges.mjs";

const ZERO = "0".repeat(40);
const A = "a".repeat(40);
const B = "b".repeat(40);

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

test("logOptsForUpdate 常规更新:remote..local 范围,带 -m 覆盖 merge diff", () => {
  const opts = logOptsForUpdate({ localRef: "r", localSha: A, remoteRef: "r", remoteSha: B });
  assert.equal(opts, `-m ${B}..${A}`);
});

test("logOptsForUpdate 新 ref(remote 全零):排除所有远端已有 commit", () => {
  // 新分支常从既有 main 岔出,--not --remotes 保证只扫真正新增的 commit
  const opts = logOptsForUpdate({ localRef: "r", localSha: A, remoteRef: "r", remoteSha: ZERO });
  assert.equal(opts, `-m ${A} --not --remotes`);
});

test("logOptsForUpdate 删除 ref(local 全零):返回 null 不扫描", () => {
  const opts = logOptsForUpdate({ localRef: "r", localSha: ZERO, remoteRef: "r", remoteSha: B });
  assert.equal(opts, null);
});
