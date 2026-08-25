/**
 * preflight 熔断集成行为规格：preflight 读取跨会话熔断状态，
 * OPEN 未到期的 launcher 不担任族 active，并在 families 输出中携带
 * circuit 详情；cooldown 到期视为可试探（互斥由 runner half-open CAS 负责）。
 *
 * 通过 CLI 子进程验证（preflight 的公共接口即其 JSON 输出），依赖本机
 * launchers.json 与 zsh launcher 名册——与 configs/launchers.example.json
 * 分发的占位环境不兼容，属本机技能测试。
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

const PREFLIGHT = path.resolve(import.meta.dirname, "preflight.mjs");

function runPreflight(t, stateJson) {
  const dir = mkdtempSync(path.join(tmpdir(), "breaker-preflight-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const statePath = path.join(dir, "circuit-breaker.json");
  if (stateJson !== undefined) {
    writeFileSync(statePath, typeof stateJson === "string" ? stateJson : JSON.stringify(stateJson));
  }
  try {
    const out = execFileSync("node", [PREFLIGHT], {
      encoding: "utf8",
      timeout: 30000,
      env: { ...process.env, FLOW_CIRCUIT_BREAKER_PATH: statePath },
    });
    return { result: JSON.parse(out), exitCode: 0 };
  } catch (err) {
    // preflight 以非零退出码报告环境不就绪，stdout 仍携带 JSON 汇总
    return { result: JSON.parse(err.stdout), exitCode: err.status };
  }
}

const NOW = Date.now() / 1000;

function openEntry(overrides = {}) {
  return {
    state: "open",
    opened_at: NOW - 10,
    cooldown_until: NOW + 3600,
    cooldown_source: "escalation",
    escalation_level: 0,
    last_error: "test",
    last_slug: "test",
    half_open: null,
    ...overrides,
  };
}

test("无状态文件时 active 取族首选且 circuit 为空", (t) => {
  const { result } = runPreflight(t, undefined);
  assert.equal(result.families["glm-5.3"].active, "cgwz");
  assert.deepEqual(result.families["glm-5.3"].circuit, []);
});

test("首选 launcher 熔断未到期时 active 顺延到下一个可用", (t) => {
  const { result } = runPreflight(t, { version: 1, launchers: { cgwz: openEntry() } });
  assert.equal(result.families["glm-5.3"].active, "cg");
  const circuit = result.families["glm-5.3"].circuit;
  assert.equal(circuit.length, 1);
  assert.equal(circuit[0].launcher, "cgwz");
  assert.equal(typeof circuit[0].cooldown_until, "number");
});

test("cooldown 已到期不视为熔断（可试探，互斥归 runner CAS）", (t) => {
  const { result } = runPreflight(t, {
    version: 1,
    launchers: { cgwz: openEntry({ cooldown_until: NOW - 1 }) },
  });
  assert.equal(result.families["glm-5.3"].active, "cgwz");
  assert.deepEqual(result.families["glm-5.3"].circuit, []);
});

test("全族熔断时族 ok=false 且非零退出", (t) => {
  const { result, exitCode } = runPreflight(t, {
    version: 1,
    launchers: { cgwz: openEntry(), cg: openEntry(), cog: openEntry() },
  });
  assert.equal(result.families["glm-5.3"].ok, false);
  assert.equal(result.families["glm-5.3"].active, null);
  assert.equal(result.families["glm-5.3"].circuit.length, 3);
  assert.equal(exitCode, 1);
});

test("状态文件损坏视为空状态不阻断 preflight", (t) => {
  const { result } = runPreflight(t, "not json{{{");
  assert.equal(result.families["glm-5.3"].active, "cgwz");
  assert.deepEqual(result.families["glm-5.3"].circuit, []);
});
