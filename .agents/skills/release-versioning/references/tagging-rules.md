# 打 Tag 规则

## 正式版 Tag 前置检查

打正式版 tag（无 `-pre`/`-beta` 后缀，如 `v1.4.0.3`）时：

1. 检查 `public/changelog/` 下是否存在对应版本的 changelog 文件（`增量更新-v<version>.md` 或 `*正式更新*-v<version>.md`）。
2. 如果不存在对应 changelog：
   - 读取 `git log` 自上一正式版以来的 `feat:` 和 `fix:` 提交，生成 `增量更新-v<version>.md`
   - 更新 `public/changelog/index.json`
   - 提交 changelog
   - 然后再打 tag
3. 如果已存在，直接打 tag。

## Pre / Beta Tag

1. 先 `git tag --sort=-v:refname | head -20` 查看历史
2. 找到最新的正式版 tag，基于下一个版本号
3. 不基于已有 pre tag 递增，应基于正式版号递增 patch 位
