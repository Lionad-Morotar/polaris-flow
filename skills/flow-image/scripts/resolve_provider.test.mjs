import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "./resolve_provider.mjs";

test("零参 → grsapi 全局默认（向后兼容）", () => {
  const r = resolve({});
  assert.equal(r.ok, true);
  assert.equal(r.provider, "grsapi");
  assert.equal(r.model, "gpt-image-2");
  assert.equal(r.source, "global-default");
});

test("仅 provider → 该 provider 默认模型", () => {
  const r = resolve({ provider: "bailian" });
  assert.equal(r.ok, true);
  assert.equal(r.provider, "bailian");
  assert.equal(r.model, "qwen-image-2.0");
  assert.equal(r.source, "explicit-provider-default");
});

test("bl-only id 自动解析 → bailian", () => {
  for (const m of ["qwen-image-2.0", "qwen-image-2.0-pro", "wan2.6-t2i", "wan2.7-image"]) {
    const r = resolve({ model: m });
    assert.equal(r.ok, true, m);
    assert.equal(r.provider, "bailian", m);
    assert.equal(r.source, "resolved", m);
  }
});

test("grsapi-only 的 qwen/wan id 回退 → grsapi（精确集优先于族前缀）", () => {
  for (const m of [
    "qwen-image-max",
    "qwen-image-2.0-2026-03-03",
    "wan2.7-image-pro",
    "qwen-image-edit-2509",
    "qwen-image-max-2025-12-30",
  ]) {
    const r = resolve({ model: m });
    assert.equal(r.ok, true, m);
    assert.equal(r.provider, "grsapi", m);
  }
});

test("gpt/gemini/mj/kling/flux/grok/vidu/z-image 族 → grsapi", () => {
  for (const m of [
    "gpt-image-2",
    "gemini-3-pro-image-preview",
    "mj_imagine",
    "kling-image",
    "flux-1.1-pro",
    "grok-4-image",
    "viduq2",
    "z-image-turbo",
    "doubao-seedream-5-0-260128",
  ]) {
    const r = resolve({ model: m });
    assert.equal(r.ok, true, m);
    assert.equal(r.provider, "grsapi", m);
  }
});

test("显式合法组合 → explicit", () => {
  const r = resolve({ model: "qwen-image-2.0", provider: "bailian" });
  assert.equal(r.ok, true);
  assert.equal(r.source, "explicit");
  assert.equal(r.provider, "bailian");
});

test("显式冲突 → UNSUPPORTED_COMBO 并建议实际可用 provider", () => {
  // qwen-image-max 在 grsapi，显式指定 bailian 应冲突并建议 grsapi。
  const r = resolve({ model: "qwen-image-max", provider: "bailian" });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "UNSUPPORTED_COMBO");
  assert.equal(r.error.suggested_provider, "grsapi");

  // gpt-image-2 在 grsapi，显式指定 bailian 应冲突并建议 grsapi。
  const r2 = resolve({ model: "gpt-image-2", provider: "bailian" });
  assert.equal(r2.ok, false);
  assert.equal(r2.error.code, "UNSUPPORTED_COMBO");
  assert.equal(r2.error.suggested_provider, "grsapi");

  // qwen-image-2.0 在 bailian，显式指定 grsapi 应冲突并建议 bailian。
  const r3 = resolve({ model: "qwen-image-2.0", provider: "grsapi" });
  assert.equal(r3.ok, false);
  assert.equal(r3.error.suggested_provider, "bailian");
});

test("显式 provider + 两侧都不存在的 model → UNSUPPORTED_COMBO 无建议", () => {
  const r = resolve({ model: "nonsense-xyz-999", provider: "bailian" });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "UNSUPPORTED_COMBO");
  // 无修复建议时省略 suggested_provider 键（访问为 undefined），而非显式 null。
  assert.equal(r.error.suggested_provider, undefined);
});

test("未知 model 自动解析 → UNKNOWN_MODEL", () => {
  const r = resolve({ model: "nonsense-xyz-999" });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "UNKNOWN_MODEL");
  assert.equal(r.error.suggested_provider, undefined);
});

test("未知族但形似 qwen 的新 id → UNKNOWN_MODEL 带族偏好建议", () => {
  const r = resolve({ model: "qwen-image-3.0-future" });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "UNKNOWN_MODEL");
  assert.equal(r.error.suggested_provider, "bailian");
});

test("非法 provider → INVALID_PROVIDER", () => {
  const r = resolve({ provider: "azure" });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "INVALID_PROVIDER");
});
