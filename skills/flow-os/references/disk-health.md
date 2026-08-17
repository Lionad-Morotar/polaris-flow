# 硬盘写入排查与 SSD 健康检查手册

排查 macOS 磁盘写入异常（如活动监视器里 `kernel_task` 累计写入暴涨）并评估 SSD 健康度。

## 认知前提（先读再动手）

- 活动监视器的「写入字节」是进程自启动以来参与的**磁盘 I/O 累计统计**，不是文件大小、也不是磁盘空间减少量。覆盖写、日志写后即删、文件系统元数据都计入。
- `kernel_task` 是内核进程，所有程序的文件操作最终都经内核记账——它是 **I/O 汇聚点（I/O aggregation point）**，不是"一个叫 kernel_task 的程序写了这么多文件"。排查必须下钻到具体进程和路径。
- 刚开机数字涨得快是常态：系统集中恢复应用状态、重建 Spotlight 索引、处理常驻应用日志。

## 分层流程

按成本从低到高分三层，绝大多数情况第一层就能定性，不必走完。

### 第一层：免 sudo 快速体检

```sh
uptime                                    # 开机时长（给累计量做分母）
sysctl vm.swapusage                       # swap 用量
vm_stat | rg -i 'swap'                    # Swapins/Swapouts 应为 0 或极低
iostat -d -w 1 -c 5                       # 当前整机 I/O 速率，采样 5 秒
iostat -d -I                              # 开机以来整盘累计传输量（读写合计）
```

判读：

- `Swapins/Swapouts` 持续非零 → 内存不足导致换页写入，先解决内存问题。
- 速率持续 >10 MB/s 且无明显 workload → 进入第二层定位来源。
- `iostat` 的 MB/s 与累计量是**读写合计**，macOS 版不区分读写方向。

### 第二层：定位写入来源（需 sudo）

采集 60 秒文件系统写入：

```sh
sudo fs_usage -w -f filesys -t 60 | rg 'WrData' > /tmp/fs_wrdata_60s.txt
```

在 Claude Code 等非交互环境里 sudo 免密不可用，让用户用 `!` 前缀自己跑：

```
! sudo fs_usage -w -f filesys -t 60 | rg 'WrData' > /tmp/fs_wrdata_60s.txt
```

按进程聚合写入次数与字节量。**macOS 自带 BSD awk 没有 `strtonum`**，十六进制转换会报错，用 perl：

```perl
#!/usr/bin/perl
# 按进程聚合 fs_usage WrData 日志的写入次数与字节量
my (%bytes, %cnt);
while (<>) {
    my $b = /B=0x([0-9a-fA-F]+)/ ? hex($1) : 0;
    my $p = 'unknown';
    $p = $1 if /(\S+)\.\d+\s*$/;
    $bytes{$p} += $b;
    $cnt{$p}++;
}
printf "%-28s %6s  %12s\n", 'proc', 'count', 'KB';
for my $k (sort { $bytes{$b} <=> $bytes{$a} } keys %bytes) {
    printf "%-28s %6d  %12.1f\n", $k, $cnt{$k}, $bytes{$k} / 1024;
}
```

存为 `/tmp/fsagg.pl` 后 `perl /tmp/fsagg.pl /tmp/fs_wrdata_60s.txt | head -25`。

再对可疑进程提取写入路径确认身份：

```sh
rg '<进程名>' /tmp/fs_wrdata_60s.txt | awk '{for(i=5;i<NF;i++) if($i ~ /^\//) print $i}' | sort | uniq -c | sort -rn | head
```

fs_usage 的进程名列会**截断含空格的名字**（如 `com.apple.Virtua…`、`H` 实为 Helper），进程名列不可全信，必须按路径二次确认。

写入模式分型：

- **滴灌型（chatty writer）**：单次几 KB 但每秒多次不间断（典型：SQLite WAL 双写 db + journal，日志型 SDK）。单次无害，日积月累放大累计数字。
- **突发型**：索引重建、大文件复制，一次性，过后自愈。

### 第三层：SSD 健康检查（需 sudo + 安装工具）

```sh
brew install smartmontools
sudo smartctl -a /dev/disk0
```

关注字段：

- `SMART overall-health`：PASSED
- `Percentage Used`：磨损百分比，越低越好；个位数说明余量充足
- `Available Spare`：应远高于 `Available Spare Threshold`
- `Media and Data Integrity Errors`：必须为 0
- `Data Units Written`：累计写入量，结合 `Power On Hours` 算平均速率
- `Unsafe Shutdowns`：异常断电次数，多但不直接伤盘，无需紧张

Apple SSD 上 `Read Error Information Log failed: GetLogPage failed ... code=745` 是常见现象，不影响健康判读。

## 什么时候才需要担心

同时满足才深入：

1. 电脑**空闲半小时后**仍持续高速写入（而非刚开机或重负载期）
2. 可用磁盘空间快速减少
3. 伴随持续卡顿或异常发热

否则观察即可——常驻应用（IM 日志、浏览器缓存、输入法、AI 工具链）的滴灌写入叠加，几周不关机累计 TB 级也属正常，对 SSD 磨损影响微乎其微。

## 已知坑

- 不要拿活动监视器累计数字当"SSD 寿命消耗速度"外推，读写混合 I/O、缓存命中、文件系统日志都会注水。
- 聚合 fs_usage 时若进程名与预期不符，先怀疑名字截断，用写入路径反查 `pgrep -fl <name>` 验证。
