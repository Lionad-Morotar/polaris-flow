# Finder 角度（Phase 1）

> 渐进披露：执行 Phase 1 时读本文件。
> `medium`/`high` 执行 8 角度（A、B、C、Reuse、Simplification、Efficiency、Altitude、Conventions），各 ≤6 候选；
> `xhigh` 执行全部 10 角度（另加 D、E），各 ≤8 候选；
> `low` 不读本文件，直接按 SKILL.md 单次通读。

每个角度独立执行；一个角度的结论不压制另一个——两个角度因不同原因标同一行时，两条都记。

候选格式：`file`、`line`、一行 `summary`、具体 `failure_scenario`（什么输入/状态 → 什么错误输出/崩溃）。

## Correctness 角度

### Angle A — line-by-line diff scan

Read every hunk in the diff, line by line. Then Read the enclosing function for
each hunk — bugs in unchanged lines of a touched function are in scope (the PR
re-exposes or fails to fix them). For every line ask: what input, state, timing,
or platform makes this line wrong? Look for inverted/wrong conditions,
off-by-one, null/undefined deref, missing `await`, falsy-zero checks,
wrong-variable copy-paste, error swallowed in catch, unescaped regex metachars.

### Angle B — removed-behavior auditor

For every line the diff DELETES or replaces, name the invariant or behavior it
enforced, then search the new code for where that invariant is re-established.
If you can't find it, that's a candidate: a removed guard, a dropped error
path, a narrowed validation, a deleted test that was covering a real case.

### Angle C — cross-file tracer

For each function the diff changes, find its callers (Grep for the symbol) and
check whether the change breaks any call site: a new precondition, a changed
return shape, a new exception, a timing/ordering dependency. Also check callees:
does a parallel change in the same PR make a call unsafe?

### Angle D — language-pitfall specialist（仅 xhigh）

Scan for the classic pitfalls of the diff's language/framework — for example:
JS falsy-zero, `==` coercion, closure-captured loop var; Python mutable default
args, late-binding closures; Go nil-map write, range-var capture; SQL injection;
timezone/DST drift; float equality. Flag any instance the diff introduces.

### Angle E — wrapper/proxy correctness（仅 xhigh）

When the PR adds or modifies a type that wraps another (cache, proxy, decorator,
adapter): check that every method routes to the wrapped instance and not back
through a registry/session/global — e.g. a caching provider holding a
`delegate` field that resolves IDs via `session.get(...)` instead of
`delegate.get(...)` will re-enter the cache or recurse. Also check that the
wrapper forwards all the methods the callers actually use.

## Cleanup 角度

cleanup 候选的 `failure_scenario` 写具体代价：重复了什么、浪费了什么、更难维护在哪。

### Reuse

Check whether the diff re-implements something that already exists: a helper in
the codebase with the same job, a standard-library or framework function, a
pattern established elsewhere in the same PR. New code that duplicates an
existing helper should call it; logic repeated within the diff should be
extracted once. Name the existing helper or location that makes the new code
unnecessary.

### Simplification

Flag complexity the diff adds without paying for itself: conditionals that can
be expressed directly, redundant intermediate variables or wrappers,
abstractions more general than any caller needs, control flow nested deeper
than the logic requires. Name the simpler equivalent.

### Efficiency

Flag wasted work the diff introduces: redundant computation or repeated I/O,
independent operations run sequentially, blocking work added to startup or
hot paths. Also flag long-lived objects built from closures or captured
environments — they keep the entire enclosing scope alive for the object's
lifetime (a memory leak when that scope holds large values); prefer a
class/struct that copies only the fields it needs. Name the cheaper
alternative.

## 横切维度

### Altitude

Check that each change is implemented at the right depth, not as a fragile
bandaid. Special cases layered on shared infrastructure are a sign the fix
isn't deep enough — prefer generalizing the underlying mechanism over adding
special cases.

### Conventions (CLAUDE.md)

Find the CLAUDE.md files that govern the changed code: the user-level
~/.claude/CLAUDE.md, the repo-root CLAUDE.md, plus any CLAUDE.md or
CLAUDE.local.md in a directory that is an ancestor of a changed file (a
directory's CLAUDE.md only applies to files at or below it). Read each one
that exists, then check the diff for clear violations of the rules they state.

Only flag a violation when you can quote the exact rule and the exact line
that breaks it — no style preferences, no vague "spirit of the doc"
inferences. In the finding, name the CLAUDE.md path and quote the rule so the
report can cite it. If no CLAUDE.md applies, return nothing for this angle.

## 候选通过纪律

凡能命名 failure_scenario 的候选一律通过——finder 默默丢弃半信半疑的候选，会绕过 verify 阶段，是漏检的主因。
