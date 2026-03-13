# 图片资源归一化流程

本文档记录项目当前的图片资源处理口径，目标是让后续新增物品、设备时都能通过脚本稳定地产生一致的运行时资源。

## 1. 当前资源分层

### 1.1 原始资源（保留，不直接用于运行时）

原始图片统一保存在以下目录：

- `public/original/itemicon/`
- `public/original/device-icons/`
- `public/original/sprites/`

说明：

1. 这些目录保存“可编辑的原图输入”。
2. 旧 PNG / SVG 不直接删除，而是归档到这里。
3. 后续新增资源时，优先把源文件放进这些目录，而不是直接放到运行时目录。

### 1.2 运行时资源

运行时只消费归一化后的输出：

- 物品图标：`public/itemicon/*.webp`
- 设备图标：`public/device-icons/*.webp`
- 设备精灵：`public/sprites/*.webp`

## 2. 归一化规则

### 2.1 设备图标

1. 所有设备菜单图标统一归一化到 `30px x 30px`。
2. 每个设备图标输出为独立小 `webp` 文件。
3. 前端直接使用 `public/device-icons/*.webp`。
4. 若某个设备复用其他设备图标，统一在 [src/assets/iconPaths.ts](../../src/assets/iconPaths.ts) 中维护别名映射。

### 2.2 物品图标

1. 所有物品图标统一归一化到 `40px x 40px`。
2. 每个物品图标输出为独立小 `webp` 文件。
3. 前端直接使用 `public/itemicon/*.webp`。

### 2.3 设备精灵

1. 设备精灵不合并。
2. 设备精灵统一转为 `webp`。
3. 保持当前像素尺寸，不额外缩放；因为画布渲染阶段仍会做缩放。

## 3. 脚本入口

统一使用：

- `npm run assets:normalize`

如需先刷新派生物品图标，再统一生成运行时资源，可使用：

- `npm run assets:refresh`

`assets:normalize` 会做三件事：

1. 将旧的活动目录图片归档到 `public/original/`。
2. 从 `public/original/itemicon/` 生成物品小 `webp`。
3. 从 `public/original/device-icons/` 与 `public/original/sprites/` 生成设备图标 / 精灵 `webp`。
4. 自动清理历史 atlas 输出目录，避免旧方案残留文件继续被引用。

## 4. 新增资源时的推荐流程

### 4.1 新增物品图标

1. 将原图放入 `public/original/itemicon/`。
2. 文件名使用目标物品 ID，例如：`item_xxx.png`。
3. 执行 `npm run assets:normalize`。
4. 检查界面显示是否正常。

### 4.2 新增设备图标

1. 将原图放入 `public/original/device-icons/`。
2. 文件名优先使用目标设备 ID；如果是复用图标的别名设备，则在代码中的别名映射里补充。
3. 执行 `npm run assets:normalize`。
4. 检查左侧工具栏、工具箱、Wiki、规划器等入口的图标显示。

### 4.3 新增设备精灵

1. 将原图放入 `public/original/sprites/`。
2. 文件名与设备精灵注册表保持一致。
3. 执行 `npm run assets:normalize`。
4. 检查画布中的朝向、透明边缘与缩放观感。

## 5. 派生资源脚本约定

现有会生成图标的脚本，也应把输出写回 `public/original/itemicon/`，再由 `npm run assets:normalize` 统一生成运行时输出。

这样可以保证：

1. 运行时资源始终由同一条归一化管线产出；
2. 原始素材与最终运行时素材职责分离；
3. 不需要维护 atlas、切片坐标或额外前端裁切逻辑。
4. 图标路径统一由 [src/assets/iconPaths.ts](../../src/assets/iconPaths.ts) 提供，避免各处手写文件名规则。

## 6. 注意事项

1. 若设备图标不是独立文件而是复用其他设备图标，需要同步更新图标别名映射。
2. 若设备精灵源图边缘存在低透明度像素，仍应优先修正源图或在导出前确认透明边缘观感。
3. 若新增资源后界面仍显示旧图，优先重新执行归一化脚本并清理浏览器缓存。
