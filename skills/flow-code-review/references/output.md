# 输出契约

> 渐进披露：所有档位在输出前读本文件。

## 严重度排序与上限

findings 按最严重在前排序。档位上限：`low` 8 / `medium` 8 / `high` 10 / `xhigh` 15。超出时保留最严重的 N 条。

## Minimum findings target

目标至少 min(files_changed, 4) 条真实发现——少于该数时，先放宽到同一 diff 的其他 hunk 再收尾；真实发现不足 4 条则如实输出已有。

## 输出分支

### 1. `--json`（程序化契约，flow-dev Step 5 使用）

输出 findings JSON 数组（即使 ReportFindings 工具可用也不调用）：

```json
[
  {
    "file": "path/to/file.ext",
    "line": 123,
    "summary": "one-sentence statement of the bug",
    "failure_scenario": "concrete inputs/state → wrong output/crash"
  }
]
```

最严重在前，最多档位上限条；无发现输出 `[]`。

### 2. ReportFindings 工具可用（默认，人类可读）

单次调用 ReportFindings，传 `{level, findings}`。findings 每条含：

- `file`、`line`、`summary`、`failure_scenario`
- `short_summary`——结论压缩到 ≤60 字符，不含理由或后果从句
- `category`——产出角度的 kebab-case slug：`correctness`、`simplification`、`efficiency`、`reuse`、`altitude`、`conventions`，或更贴切的 slug（如 `test-coverage`）
- `verdict`——verify 阶段产出了判定（CONFIRMED/PLAUSIBLE）时附上

不要再以文本重复打印 findings；工具调用即报告。

### 3. 工具不可用 fallback

终端文本，每行一条：

```
path/to/file.ext:123 — 问题与具体失败
```

最严重在前。
