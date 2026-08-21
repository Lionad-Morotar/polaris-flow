# Claude Code 插件版本号同步

Claude Code 插件的版本分散在多处，且每一处的作用不同。发版只更新其中一处时，其余各处会以各自特定的形态失真——失真全部静默：安装与更新均不报错，只是版本标签或内容错位。

## 三处版本源及其实际作用

| 位置 | 作用 | 漏更的故障形态 |
| --- | --- | --- |
| `package.json` version | 构建期注入产物（如 tsup define 的版本常量），产物自报版本的来源 | 产物内嵌版本滞后，运行时诊断输出误导 |
| `plugin.json` version | 安装版本标签：CC install 后写入 installPath 目录名与 `installed_plugins.json`，即 `/plugin` 列表所见版本 | 标签滞后于内容——用户看到旧版本号，按旧版本的行为与文档排障，方向性误导 |
| marketplace.json `version` | marketplace 索引展示版本 | 索引不提示新版本，已安装用户不触发更新 |
| marketplace.json `source.ref` | install 实际拉取的 git ref（缺省 = 默认分支 HEAD） | 索引声称版本 A，安装内容实为默认分支 HEAD（A 之后的任意提交），静默漂移 |

关键实证：安装版本标签取自插件仓库的 plugin.json，不是 marketplace.json；install 内容取自 source.ref，也不是 marketplace.json 的 version。marketplace.json 的两个字段都只是索引层声明，与真实安装结果无强制关联——CC 不会替你做一致性校验，三处必须由发版流程同步。

本指南源于一次真实事故：一次 minor 发版漏更 plugin.json，安装标签停留在上一个版本而内容已是新版本；另一台机器按旧版本号对照文档排障，在"为什么行为与文档不符"上空耗。同次发版 marketplace 也未锁 source.ref，install 拉取的是默认分支 HEAD 而非发版 tag。

## preflight 机械防线

flow-release 的 preflight/postflight 识别到 `.claude-plugin/plugin.json` 时判定发布目标为 `cc-plugin`，自动：

- 跳过 npm registry 检查（插件不经 npm 分发；npm 上存在同名无关包时，查到的版本号也是误导）
- 校验三处版本一致：plugin.json、marketplace.json(version)、marketplace.json(source.ref = 目标 tag)，不一致即 fail
- preflight（bump 前）发现存量脱节，postflight（bump 后）复核同步完整性

## marketplace 位于 git 子模块时的发版顺序

marketplace.json 常以独立仓库（主仓子模块）维护。这里存在两个方向的引用，推送顺序要同时满足：

- 主仓 gitlink → 子模块 commit：clone 主仓（含 submodule update）时按 hash 解析，指向子模块未推送的 commit 会让 clone 悬空
- 子模块 source.ref → 主仓 tag：install 插件时按 tag 名解析，指向主仓未推送的 tag 会让 install 悬空

两个引用成环（主仓 release commit 引用子模块 commit、子模块引用主仓 tag），单一 release commit 无论哪侧先推，另一侧都在推送窗口内悬空——流程中断（崩溃、推送失败、网络断）即从窗口变成持久故障。把主仓 release 拆成两个 commit 可以彻底解环：

1. 主仓提交 release commit（package.json / plugin.json 版本、CHANGELOG、产物重建；**不含子模块指针**），合并发版分支、打 tag、推送 main 与 tags——此刻起 tag 在远端存在
2. 子模块内提交 marketplace 改动（version + source.ref 指向该 tag）并推送——ref 指向已存在的 tag
3. 主仓单独提交子模块指针 bump 并推送——gitlink 指向已推送的子模块 commit

任何一步中断都无悬空：marketplace 滞后时 install 到旧版本（旧 ref 仍有效），主仓指针滞后时 clone 拿到旧子模块（旧 commit 仍存在），重跑流程即可收敛。代价是 tag 树内的子模块指针滞后一个 commit——install 走 marketplace 仓索引与插件仓 tag，不经过主仓 gitlink，无实际影响。

反向顺序（子模块先推、主仓 tag 后推）的故障形态：子模块已推送而主仓 tag 未推送期间，marketplace 索引声称的 ref 在远端不存在，窗口内 install 直接失败；中断则悬空持久化，install 持续失败直到人工补推 tag。

## 发布流程

1. 变更完成后确定版本号。
2. 同步三处：package.json、plugin.json、marketplace.json（version + source.ref）。
3. 跑 preflight 确认无 fail（三处版本同步已机械校验）。
4. 更新 CHANGELOG，与版本改动一起提交。
5. 按上节顺序推送：主仓 release commit 与 tag 先行，子模块 marketplace 改动次之，主仓子模块指针 bump 单独提交收尾。
6. 插件含构建产物（如 scripts/*.js 随仓分发）时，版本 bump 后先重建产物再跑门禁链——产物内嵌版本由构建期 define 注入，"prebuild → test"次序下旧产物会让版本断言先失败一次。

## 注意事项

- 不要依赖 `npm version` 完成同步，它只改 package.json。
- 文档中的版本示例若与真实版本脱节，会让安装者产生困惑。
- 首次发布前，确认 author、license、repository 等元数据完整。
