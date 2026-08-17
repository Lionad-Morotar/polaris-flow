# Phase 2 — 去重与验证

> 渐进披露：按档位只读所需小节——`medium` 读「Dedup」与「Self-check」；`high` 读「Dedup」与「Recall-biased verify」；`xhigh` 读「Dedup」与「3-state verify」（含 recall 注解）。

## Dedup

近重复合并：同缺陷、同位置、同原因 → 保留 failure_scenario 最具体的一条。合并后按严重度排序。

## Self-check（medium）

不 spawn 子代理。对照 diff 逐条复检每个剩余候选：代码确实如候选所述、触发路径真实存在、缺陷未被他处守卫。复检不过的丢弃。

## Recall-biased verify（high）

每个剩余候选 spawn 1 个 verifier 子代理（Agent 工具），给它 diff、相关文件与候选，返回恰好一票：**CONFIRMED / PLAUSIBLE / REFUTED**。rubric：

**PLAUSIBLE by default** — do not refute a candidate for being "speculative" or
"depends on runtime state" when the state is realistic: concurrency races,
nil/undefined on a rare-but-reachable path (error handler, cold cache, missing
optional field), falsy-zero treated as missing, off-by-one on a boundary the
code does not exclude, retry storms / partial failures, regex/allowlist that
lost an anchor. These are PLAUSIBLE.

**REFUTED** only when constructible from the code: factually wrong (quote the
actual line); provably impossible (type/constant/invariant — show it); already
handled in this diff (cite the guard); or pure style with no observable effect.

保留 **CONFIRMED 和 PLAUSIBLE**，丢弃 REFUTED。

## 3-state verify（xhigh）

每个剩余候选 spawn 1 个 verifier 子代理（Agent 工具），给它 diff、相关文件与候选，返回恰好一票：

- **CONFIRMED** — can name the inputs/state that trigger it and the wrong
  output or crash. Quote the line.
- **PLAUSIBLE** — mechanism is real, trigger is uncertain (timing, env,
  config). State what would confirm it.
- **REFUTED** — factually wrong (code doesn't say that) or guarded elsewhere.
  Quote the line that proves it.

保留 **CONFIRMED 和 PLAUSIBLE**。

**recall 注解（xhigh 适用）**：这是 recall 模式——单个非 REFUTED 票即携带该发现。不确定不丢。
