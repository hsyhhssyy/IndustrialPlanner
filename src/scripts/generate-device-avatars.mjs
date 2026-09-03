// AI-REMOVED 2026-09-03:
// Reason: 黑白设备头像资源已退出产品运行时，继续保留生成逻辑会重新创建废弃目录。
// Trigger: 用户确认当前无人使用黑白头像，并授权移除 public/device-avatar/ 与本脚本。
// Evidence: 全仓引用审计确认该脚本无调用方，public/device-avatar/ 无运行时消费者；当前头像由 public/3d-top-view/avatar/ 与 public/blueprint-view/avatar/ 提供。
// Replacement: public/3d-top-view/avatar/ 与 public/blueprint-view/avatar/
// Risk: Low；仍可能存在仓库外未记录的人工调用流程。
// Human Review: Required
//
// Original code:
// #!/usr/bin/env node
// 
// /**
//  * 将 device-icons 批量转换为黑白版 device-avatar。
//  *
//  * 作用：
//  * 1. 递归读取 public/device-icons 下的图片。
//  * 2. 保持原相对路径、文件名和扩展名输出到 public/device-avatar。
//  * 3. 将图标转为黑白图，同时保留透明通道。
//  *
//  * 用法：
//  *   node src/scripts/generate-device-avatars.mjs [sourceDir] [outputDir]
//  */
// 
// import { mkdir, readdir } from 'node:fs/promises';
// import path from 'node:path';
// import { fileURLToPath } from 'node:url';
// import sharp from 'sharp';
// 
// const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
// const projectRoot = path.resolve(scriptDirectory, '..', '..');
// const defaultSourceDirectory = path.join(projectRoot, 'public', 'device-icons');
// const defaultOutputDirectory = path.join(projectRoot, 'public', 'device-avatar');
// const supportedExtensions = new Set(['.png', '.webp', '.jpg', '.jpeg']);
// 
// async function collectImageFiles(directoryPath) {
//   const entries = await readdir(directoryPath, { withFileTypes: true });
//   const sortedEntries = entries.sort((left, right) => left.name.localeCompare(right.name));
//   const files = await Promise.all(
//     sortedEntries.map(async (entry) => {
//       const entryPath = path.join(directoryPath, entry.name);
// 
//       if (entry.isDirectory()) {
//         return collectImageFiles(entryPath);
//       }
// 
//       if (entry.isFile() && supportedExtensions.has(path.extname(entry.name).toLowerCase())) {
//         return [entryPath];
//       }
// 
//       return [];
//     }),
//   );
// 
//   return files.flat();
// }
// 
// async function writeBlackAndWhiteAvatar(sourceFilePath, sourceDirectory, outputDirectory) {
//   const relativeFilePath = path.relative(sourceDirectory, sourceFilePath);
//   const outputFilePath = path.join(outputDirectory, relativeFilePath);
// 
//   await mkdir(path.dirname(outputFilePath), { recursive: true });
// 
//   let pipeline = sharp(sourceFilePath).greyscale();
//   const outputExtension = path.extname(sourceFilePath).toLowerCase();
// 
//   if (outputExtension === '.webp') {
//     pipeline = pipeline.webp({ lossless: true, effort: 6 });
//   }
// 
//   if (outputExtension === '.png') {
//     pipeline = pipeline.png();
//   }
// 
//   if (outputExtension === '.jpg' || outputExtension === '.jpeg') {
//     pipeline = pipeline.jpeg({ quality: 100, mozjpeg: true });
//   }
// 
//   await pipeline.toFile(outputFilePath);
// 
//   return outputFilePath;
// }
// 
// async function main() {
//   const sourceDirectory = path.resolve(process.argv[2] ?? defaultSourceDirectory);
//   const outputDirectory = path.resolve(process.argv[3] ?? defaultOutputDirectory);
//   const sourceFiles = await collectImageFiles(sourceDirectory);
// 
//   if (sourceFiles.length === 0) {
//     console.log(`No supported image files found in ${sourceDirectory}`);
//     return;
//   }
// 
//   for (const sourceFilePath of sourceFiles) {
//     await writeBlackAndWhiteAvatar(sourceFilePath, sourceDirectory, outputDirectory);
//   }
// 
//   console.log(`Generated ${sourceFiles.length} device avatar(s) in ${outputDirectory}`);
// }
// 
// main().catch((error) => {
//   console.error('Failed to generate device avatars.');
//   console.error(error);
//   process.exitCode = 1;
// });
