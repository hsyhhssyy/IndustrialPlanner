# 无头 EDA 任务计算

在网页“蓝图规划任务”中下载任务文件，交给同一版本的客户端运行：

```bash
node src/scripts/run-eda-task.mjs --task /path/line.eda-task.json --proposals 100000
node src/scripts/run-eda-task.mjs --task /path/line.eda-task.json
node src/scripts/run-eda-task.mjs --task /path/line.eda-task.json --proposals 100000 --shard-count 32 --shard-range 0:16 --output /path/part-0-1.json
node src/scripts/run-eda-task.mjs --task /path/line.eda-task.json --proposals 100000 --shard-count 32 --shard-range 16:32 --output /path/part-2-3.json
node src/scripts/run-eda-task.mjs merge --output /path/merged.json /path/part-0-1.json /path/part-2-3.json
```

`--proposals` 是本次追加计算在全部分片上的提案总上限，省略时持续计算。分片总数固定为 32，`--shard-count` 若提供只能是 32；`--shard-range A:B` 运行编号 A 至 B−1。每个尺寸唯一归属一个分片，分片允许为空。Worker 每次领取一个宽高最多 5,000 次，提交后才推进该分片游标。选中范围没有可执行尺寸时保存并结束，不借用其他分片、不空转。

各参与者从同一份任务出发，选择不重叠且合计覆盖 0:32 的范围，输出到不同文件再合并。相同面积目标与约束产生同一尺寸分配；进程之间无实时广播，独立发现新最优后可能暂时处于不同目标。合并时以胜出目标统一清单，异目标游标归零、旧候选清除，已提交累计计数保留。网页与无头端使用同一 Host；并发配置只控制 Worker 容量，不改变分片。

Ctrl+C 暂停并保存检查点。网页和无头客户端均只按提案预算结束一轮，不设规划时长。各 Worker 本地计数，在阶段边界汇总；总次数允许少量偏差，不逐提案同步。强制杀死进程、断电或网页刷新只能恢复最后完成阶段的检查点；进行中的局部搜索会重做。合并后的累计提案数和最优结果保留；跨机器没有可信的全局事件时钟，因此曲线只在合并时的准确总计数处记录当前最优面积，后续规划继续积累下降点。

默认输出到输入文件旁的 `.continued.json`，使用 `--output` 指定其他路径。每个已完成阶段以原子替换落盘；相同输出路径用锁文件防止重复写入。异常断电遗留锁文件时，应先确认没有相关进程，再手动移除锁。输出文件可以重新导入网页或继续交给客户端。

任务算法版本为 `dimension-shards-1`，包含请求、已验证结果、待验证候选、种子池、32 片的宽高/面积/正权重列表、轮转游标与调度代次。它不是 Worker 调用栈快照：未完成的局部搜索可能重做。未知算法版本明确拒绝导入，不静默丢弃检查点。

`external-boundary-1` 保留已验证结果和全部历史，只在首次运行生成新尺寸清单；完整旧分片集合可升级到 32 片，部分集合须先合并。

`compact-portfolio-1`、`compact-portfolio-2`、`compact-breadth-1` 的旧任务支持迁移为当前盒外存取线规则：保留历史次数、耗时与曲线；最优蓝图移除存取线后重新计算面积，通过边界及真实仿真验收时，只更新曲线末点并继续使用该布局。旧布局不合格时保留历史，从原累计次数继续寻找有效结果。旧种子池和分片内部状态重建，因此协作计算应先迁移得到同一份当前版本任务，再分发给各参与者。首次迁移会额外执行一次验收；取消、超时或服务异常时保留原始输入文件。已经被旧版本清空并覆盖的历史须从原任务导出或备份恢复。

仿真固定使用 dense-v2、每仿真秒两个真实 tick。成功结果及输入、验证报告保存到 `.temp/eda/success/`。网页任务保存在独立 IndexedDB 中，不参与同步；清除网站数据会删除本机任务，下载的任务文件可用于恢复。

无头入口使用 CPU Worker；浏览器 CPU 与 GPU 布局通道共用本次尺寸分片规则。
