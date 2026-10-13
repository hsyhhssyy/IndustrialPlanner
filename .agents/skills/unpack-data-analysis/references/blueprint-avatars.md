# AKEData 建筑蓝图 avatar

## 来源与版本

AKEData 提供游戏建筑蓝图图标，可用于新增建筑的 avatar。它们与彩色物品图标、建筑俯视图、蓝图本体 sprite 是不同素材。

- 资产索引：`https://data.akedata.wiki/asset-sync-index.json`。
- 图片记录：`datasets.images.files[原始路径]`，包含 `size`、`md5`、`version`。
- 建筑蓝图图标目录：`assets/beyond/dynamicassets/gameplay/ui/sprites/factory/buildingpanelicon/`。
- 图片 URL：`https://data.akedata.wiki/public/images/<索引中的原始路径>`。
- `buildingpaneliconbig/` 中也有部分同名大图；它与普通目录是不同文件，必须按完整路径选择，不能只匹配文件名后取第一个结果。
- 本地旧素材目录：`.temp/素材库/解包素材库/设备蓝图图标/`。

图片为共享资产，不按 TableCfg 的完整版本 ID 保存。一次任务固定一份索引及其 `revision`，逐文件记录 `version`；不保证能取得任意历史 TableCfg 版本对应的图片。下载后校验大小和 MD5，失败时停止，不静默切换目录或来源。请求可使用 `User-Agent: Mozilla/5.0` 与 `Referer: https://www.akedata.wiki/`；遇到 403 时不能据此判断图片不存在。

2026-10-13 核查：本地目录的 72 张 PNG 在资产索引中均有同名资源；抽查 `icon_port_soil_1.png`、`icon_port_mix_pool_1.png`、`icon_port_planter_1.png`，远端与本地解码后的 RGBA 像素完全一致。PNG 编码方式不同，文件 MD5 可以不同；远端下载校验必须使用远端索引的 MD5，不能使用本地旧 PNG 的 MD5。

## 定位与获取

1. 按用户原始中文名称查询 i18n，确认设备 ID 与当前 `spriteId`。优先使用已审阅的素材映射；没有映射时先核对目录候选和图案，不自行翻译名称或根据设备 ID 拼出一个猜测的文件名。
2. 在索引中按完整目录查找已确认的图标。一个原图可以服务多个项目实体，但需要明确的共享素材依据；不要为语义变体虚构独立图片。
3. 原件和一次性处理脚本放在 `.temp/.trash/` 的独立批次中。记录索引 `revision`、原始路径、来源 URL、`version`、MD5、大小与下载 SHA-256；完成后清理一次性批次，验收证据按项目产物规则保留。

以下示例只下载并校验已确认的通用田块原图，不修改 `public/`。其他建筑必须先替换成核对过的完整路径。

```bash
node --input-type=module <<'JS'
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';

const headers = { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.akedata.wiki/' };
const indexUrl = 'https://data.akedata.wiki/asset-sync-index.json';
const assetPath = 'assets/beyond/dynamicassets/gameplay/ui/sprites/factory/buildingpanelicon/icon_port_soil_1.png';
const indexResponse = await fetch(indexUrl, { headers, signal: AbortSignal.timeout(30000) });
if (!indexResponse.ok) throw new Error(`资产索引 HTTP ${indexResponse.status}`);
const indexBytes = Buffer.from(await indexResponse.arrayBuffer());
const index = JSON.parse(indexBytes.toString('utf8'));
if (index.schemaVersion !== 2 || !index.revision) throw new Error('资产索引格式不受支持');
const record = index.datasets?.images?.files?.[assetPath];
if (!record || !Number.isInteger(record.size) || !/^[0-9a-f]{32}$/.test(record.md5)) {
  throw new Error(`资产缺失或记录无效：${assetPath}`);
}
const sourceUrl = new URL(`/public/images/${assetPath}`, 'https://data.akedata.wiki').href;
const response = await fetch(sourceUrl, { headers, signal: AbortSignal.timeout(30000) });
if (!response.ok) throw new Error(`图片 HTTP ${response.status}`);
const bytes = Buffer.from(await response.arrayBuffer());
const md5 = createHash('md5').update(bytes).digest('hex');
if (bytes.length !== record.size || md5 !== record.md5) throw new Error('图片大小或 MD5 与固定索引不符');
await mkdir('.temp/.trash', { recursive: true });
const batch = await mkdtemp('.temp/.trash/akedata-blueprint-avatars-');
const manifest = {
  source: 'akedata', indexUrl, revision: index.revision,
  indexSha256: createHash('sha256').update(indexBytes).digest('hex'),
  downloadedAt: new Date().toISOString(),
  files: [{ assetPath, sourceUrl, ...record, sha256: createHash('sha256').update(bytes).digest('hex') }],
};
await writeFile(path.join(batch, 'asset-sync-index.json'), indexBytes);
await writeFile(path.join(batch, path.basename(assetPath)), bytes);
await writeFile(path.join(batch, 'source-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(batch);
JS
```

## 发布与验收

Search-First 结论为 **Compose**：复用已声明的 `sharp`、`src/scripts/colorize-blueprint-avatars.mjs` 的灰色着色规则，以及 `src/scripts/publish-device-label-avatars.mjs` 导出的 `createWhiteShadowPixels`；无需新增依赖或 Renderer 特例。

1. `public/blueprint-view/avatar/<spriteId>.webp` 保存灰色版本（RGB `124,124,124`），保留原图 alpha 与图案。白色是图标主体，不能执行去白背景；仅为适配目标画布缩放，不擅自镜像、旋转或改变轮廓。
2. 现有设备沿用目标 avatar 的画布尺寸；新设备先核对所选原图与同类资源尺寸，不把 76×76 或 128×128 设为所有设备的统一约束。输出使用 lossless WebP。
3. 复用 `createWhiteShadowPixels` 对本次目标生成白色主体、深色轮廓和右下阴影，写入 `public/3d-top-view/avatar/<spriteId>.webp`。该函数可以直接导入，CLI 入口会重新发布整个 avatar 目录，局部任务只处理本次目标。
4. 当前设备标签统一读取 `top-view-avatar-<spriteId>`，包括蓝图样式；`TextureManager` 映射到 `public/3d-top-view/avatar/`。只补灰色目录会留下实际标签空缺。
5. 检查原图和派生图案、alpha、尺寸、颜色与阴影，确认运行时引用使用当前 `spriteId`。若仍不显示，再检查标签资格、`AvatarHidden`、图标设置与纹理加载结果；不能只用文件存在或尺寸正确判定完成。涉及画面验证时遵循项目的三个 Screen Profile、串行执行和逐轮清理规则。

## 已确认的田块共享映射

通用原图为 `buildingpanelicon/icon_port_soil_1.png`，76×76，图中有实际图案。它适用于当前十种普通田块：

```text
soil_grass_1, soil_grass_2,
soil_moss_1, soil_moss_2, soil_moss_3,
soil_bbflower_1,
soil_sp_1, soil_sp_2, soil_sp_3, soil_sp_4
```

这些设备的 `spriteId` 与设备 ID 相同，现有 avatar 目标画布为 128×128。使用同一通用图案，不假定存在每种作物独立的蓝图图标。2026-10-13 修复前两套 avatar 均只含空心方框，不能把该派生结果当成原图缺失的证据。
