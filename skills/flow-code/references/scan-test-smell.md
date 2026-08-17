# --scan 坏味道扫描规则：坏味道测试

> 来源：2026-07-28 某内部项目测试套件排查实证（4522 用例中先清出 278 个假测试用例，随后全量移除重建）。
> 本文是 Workflow B 的测试维度规则：判定框架、坏味道分类、搜索模式、判定纪律。backup/兜底模式见 scan-backup-pattern.md。

## 什么是坏味道测试

AI 批量补测试时的典型倾向：测不了真行为（自动导入难 mock、依赖重、环境缺），就退而写「看起来像测试」的断言——import 一下、自造字面量断言一下、把源码照抄成断言。单看每个文件都在跑且全绿，合起来是系统性坏味道：用例数虚增稀释注意力、用例名给出虚假安全感、改源码要同步多处镜像断言。扫描的目标是把这类模式从「低价值但真实的 smoke / 契约锁定」（豁免或知晓区）中分离出来。

## 判定框架（每个候选过三问）

1. 会红吗：这个测试什么情况下会失败？构造不出失败场景 = 永真断言，直接确认。
2. 红了意味着源码错吗：失败指向源码缺陷，还是仅指向「源码变了 / 测试自身 / 环境配置」？镜像式测试红只意味着源码变了，改源码的人同步改测试即转绿，抓不到错误变更。
3. 断言够得着用例名吗：用例名里的行为词（级联、引用、传递、校验、映射）在断言体里找得到对应检查吗？找不到 = 测试名说谎。

核心判据——差异断言（differential assertion）：把被测输入换成另一组，断言还绿吗？换输入仍绿 = 断言未连接被测行为。此判据优于密度统计：CRUD 行为链里 set→get 断言 defined、delete→get 断言 undefined 是真测试（断言区分操作差异），而参数排列 + 一律 defined 是假测试（断言不区分输入差异）。

## 坏味道分类与搜索模式

### 1. 零 import 自证

信号：spec 不 import 任何被测模块，自造字面量/常量再断言自己的字面量。
实证：enums-logic.spec.ts 146 行零 import，含 `expect('correct').toBe('correct')` 恒真断言与「push 后断言 toContain」的 JS 语言语义测试。
判定：全文无指向源码的 import 即确认。

```
rg --pcre2 "expect\((\w|\d+|'[^']*')\)\.to(?:Be|Equal)\(\1\)" tests/   # 恒真断言
fd -e spec.ts . tests/ -x rg -L "^import"                              # 零 import 文件
```

### 2. mock 自证

信号：vi.mock 掉全部外部依赖后，断言产物属于 mock 类、或 mock 被调用（而触发方式仅是源码照常 new/调用一次）。
实证：mock llamaindex 后 `expect(pipeline).toBeInstanceOf(MockIngestionPipeline)`——断言 mock 是 mock。
判定：断言结果与真实依赖行为无关即确认。例外：验证装配参数（Pool 收到正确 connectionString、gateway 收到正确档位）属真实行为，保留。

### 3. import 空壳

信号：唯一或主要用例是「模块可导入」，`await import()` + toBeDefined + typeof function。
判定：import 失败测试文件加载即红，断言恒真；纯类型模块（运行时零导出）import 后只剩空对象，更无意义。
生成指纹：注释自认「无法在 vitest 中轻易模拟，仅验证模块可正常导入」——自动导入 mock 基建债的占位产物，每个都是一处未解决的基建问题。

```
# ≤20 行小文件中 import 断言占比过半的
rg -l "await import\(" tests/ -g "*.spec.ts"
```

### 4. 测试名说谎

信号：用例名含行为词（级联、引用、传递、校验、映射、级联删除），断言体只有存在性检查。
实证：「外键 user_id 引用 users.id（级联删除）」只断言 notNull/hasDefault，references 从未检查；「search 参数正确传递」只断言 result defined，参数去向从未验证。
判定：行为词在断言里找不到对应检查即确认。危害超过无测试：它提供「已验证」的虚假文档。

### 5. 参数排列 smoke

信号：连续多个用例排列不同输入 mock，断言相同输出（通常齐刷刷 toBeDefined）。
实证：source=my/public/draft/all 四连用例共享同一 mockDbResult，各自断言 defined + hasProperty('list')，彼此等价。
判定：差异断言判据——换输入断言仍绿即确认。常与测试名说谎共生。

### 6. 镜像结构断言

信号：把源码声明逐字段重写为断言：Object.keys 反射枚举键、`col.name).toBe('...')` 逐列重写、notNull/hasDefault 逐个断言、硬编码总数 toBe(22)。
判定：断言无独立信息源即确认——只锁无意变更，不锁错误变更；硬编码计数让合法加列也变红（fragile）。
连带反模式：`if (!x) continue` / 空值静默跳过，断言目标缺失时测试照样绿。
例外（豁免区）：契约值锁定——pgEnum enumValues 值序是 DB 迁移契约、SSE 事件名是前后端契约，锁它们有真实价值。

```
rg -n "\.name\)\.toBe\('" tests/ -g "*.spec.ts"
rg -n "Object\.keys\(" tests/ -g "*.spec.ts"
rg -n "if \(!\w+\) continue" tests/ -g "*.spec.ts"
```

### 7. 多文件重复覆盖

信号：同一行为被 N 个文件重复断言（all/individual/单表/index 同测一批对象）。
实证：favorites 表被 4 个 spec 重复断言列名与 notNull，改 schema 需同步四处。
判定：跨文件 rg 同名 describe/it 标题可发现；不同时期批量生成的两套套件未互相察觉是典型成因（文件创建时间聚类相差两周以上而断言内容同构）。

### 8. 断链环境断言

信号：断言的是测试配置本身（vitest.config 注入的 env），或把源码某行复制进测试执行再断言——复制错了也不失败，与源码无绑定。
实证：`expect(process.env.NUXT_DB_URL).toBe('postgresql://test:test@...')` 实际在测 vitest.config.ts 的 env 设置生效，源码回退逻辑改成什么都不影响结果。

## 扫描启发式（机器预筛，人工定性）

- toBeDefined 密度 >20% 进候选（必须再过差异断言判据；CRUD 配对断言是实测最多的误报源）
- 文件名指纹：-coverage / -full / -all / -individual / -types / -supplement 后缀
- 纯类型模块有对应 spec（源文件零运行时导出 + 同名 spec 存在）
- git 聚类指纹：同一分钟批量创建的 spec 几乎必是生成产物，与 commit 署名无关——`git log --format='%ad %an' --date=format:'%m-%d %H:%M'` 按分钟聚类比作者维度更硬
- 用例名行为词清单（级联/引用/传递/校验/映射/正确/完整）与断言体关键词（references/mock 调用参数/toEqual）不匹配

## 判定纪律（实测纠过的错）

1. 密度信号只是候选不是结论：本轮 toBeDefined 密度 ≤18% 的文件几乎全是误报（conversation-store CRUD 链、confirmation-gateway 状态机、ApprovalCard 属性存在性）。每个候选必须构造一个「怎样会红」的场景再定性。
2. smoke 与假测试分开：真实调用真实代码、只断言接口形态（createRunner 返回有 run 方法）是低价值 smoke，防重构呆，归知晓区；不调用真实代码或断言不连行为的才是假测试，归删除区。
3. 删测试连着失败信号一起删：删除套件前先过现存失败用例——本轮 11 个存量失败中埋着 pageSize 12→10 的真实回归（无人认领）。真回归先记为遗留问题再删测试，否则测试死了 bug 活着。
4. 覆盖对照先于删除：删 API/模块测试前查残余覆盖（e2e、service 层、其他 spec），裸奔区域在列表中如实交代。

## 输出衔接

测试坏味道默认进轴二代码卫生（零运行时风险，纯删除）。两个例外可进轴一：测试名说谎（误导性文档，维护者按不存在的保障做决策）；存量失败用例中的真回归（活 bug，failure_scenario 即该用例的失败场景）。

## 与 flow-dx 的配合：机器可判定模式固化为 lint 防线

--scan 是人工狩猎，同一模式靠人反复扫是浪费。发现按可自动化程度（automation ceiling）分三档处置：

1. 语义判断类（测试名说谎、参数排列、多文件重复覆盖、断链环境断言）：断言与用例名的意图匹配 lint 做不了，保持人工扫描。
2. 社区插件已覆盖类：装插件优于自研。近似映射——`if (!x) continue` 静默跳过 → vitest/no-conditional-in-test；跨文件重复用例标题 → vitest/no-identical-title；断言缺失 → vitest/expect-expect。接入时先核对 eslint-plugin-vitest 当期规则清单，映射以实际规则为准。
3. 组织特有模式（零 import 自证、import 空壳、镜像结构断言行）：经 flow-dx lint 基建固化为 `eslint-plugin-<org>` 自定义规则，落地路径见 flow-dx 的 lint-infra 手册（规则模板 → 项目自研插件 → RuleTester 测试随 tests/eslint）。

固化时机：同一模式第三次出现在扫描报告前应考虑固化（rule of three）；扫描中发现「已有规则可防却反复出现」的命中，正确动作是去 flow-dx 补规则，而不是把它继续写进下一份报告。先例：`eslint-plugin-<org>` 的 no-tracking-marker 即由反复出现的问题固化（flow-dx 模板 + RuleTester 测试），backup 手册第 8 类「保留参数 + lint 压制」同理归此通道。
