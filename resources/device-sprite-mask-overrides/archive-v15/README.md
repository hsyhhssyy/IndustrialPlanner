这些遮罩于 2026-09-10 随 v1.5 建筑俯视图接入归档，保留旧文件供审计。

新版素材画布与旧图不同，静态遮罩从新图 Alpha 生成，动画遮罩取全部逻辑帧的 Alpha 并集。
本目录不再作为当前素材的 override 使用，避免后续同步把旧轮廓写回新版素材。

2026-09-11 追加归档：`item_pipe_splitter.webp`、`item_pipe_converger.webp`、`item_pipe_admission.webp`、`item_log_splitter.webp`、`item_log_converger.webp`、`item_log_admission.webp`。
这些旧 override 的画布不能覆盖新版 ZIP 提供的 3×3 helper 遮罩；继续留在 active override 目录会覆盖新遮罩，因此按原字节移入本归档目录供审计。
