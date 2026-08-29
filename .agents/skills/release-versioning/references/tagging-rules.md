# 打 Tag 规则

## 正式版 Tag 前置检查

打正式版 tag（无 `-alpha`/`-pre`/`-beta` 后缀，如 `v1.4.0.3`）时：

1. 检查 `public/changelog/` 下是否存在对应版本的 changelog 文件（`增量更新-v<version>.md` 或 `*正式更新*-v<version>.md`）。
2. 如果不存在对应 changelog：
   - 读取 `git log` 自上一正式版以来的 `feat:` 和 `fix:` 提交。
   - 使用 `changelog-writing` skill 生成 `增量更新-v<version>.md` 并更新 `public/changelog/index.json`。
   - 只有用户明确授权提交这些源码改动时，才使用 `project-commit` skill 提交 changelog；发布或打 tag 的授权本身不等于源码提交授权。
   - 未获得源码提交授权时，停止发布流程并请求用户确认；不得在工作区仍有待提交 changelog 时继续打 tag。
3. 如果已存在，直接打 tag。

## Alpha Tag

1. Alpha tag 格式只能是 `vX.Y.Z-alphaN` 或 `vX.Y.Z.N-alphaN`。
2. Alpha 的版本主体选择遵循下方 Pre / Beta 规则；`alphaN` 序号只在相同版本主体的 Alpha tag 内递增。
3. Alpha 包含尚未公开的保密内容，只能推送到当前项目的私有 `origin`；不得把 Alpha tag 或对应提交推送到公开 `upstream`。
4. Alpha 使用 `DEPLOY_CONFIG.backend_api_base_urls.beta` 后端默认 URL，但只发布私有 Docker 镜像和 K8s Alpha 环境，不创建 GitHub Release，不部署 EdgeOne 或 GitHub Pages。
5. 发布成功后的入口是 `https://endfield-alpha.hsyhhssyy.net/<完整 commit SHA>/`；完整 SHA 必须取 tag 实际指向的 commit，不得截短、改用 tag 名或增加 latest 别名。
6. Alpha 是单实例环境：新 Alpha 发布会切换唯一有效 SHA 路径，旧 SHA 路径随即失效。
7. Alpha 镜像必须写入 `DEPLOY_CONFIG.alpha_image_name` 指向的私有镜像仓库；无法确认镜像仓库为私有时停止发布并要求用户确认。
8. 用户约定：对应 SHA 进入公开仓库时，该版本已经解密；这不构成提前把私有提交、镜像、构建产物或 Action 日志公开的授权。

## Pre / Beta Tag

1. 先 `git tag --sort=-v:refname | head -20` 查看历史
2. 找到最新的正式版 tag，基于下一个版本号
3. 不基于已有 pre tag 递增，应基于正式版号递增 patch 位
