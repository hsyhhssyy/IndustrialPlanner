// AI-REMOVED 2026-09-13:
// Reason: 移除两个已退役的 npm 素材入口。
// Trigger: 用户要求将网站导入固化为技能并清理旧导入脚本；本轮禁止实际导入。
// Evidence: 相关脚本已完整注释存档；npm 脚本不保留失效命令。
// Replacement: .agents/skills/import-building-assets/SKILL.md
// Risk: 旧命令不再可用；既有资源及通用发布函数保留。
// Human Review: Required
// Source: package.json scripts
// Source SHA-256: 9775ef0cd5f3c197a7a0e91110d90de25022aad33cd7a76fb77e0e7323631cfa
//
// Original code:
//     "format-device-sprites": "node src/scripts/format-device-sprites.mjs",
//     "split-device-sprites": "node src/scripts/split-device-sprites.mjs",
