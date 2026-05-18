#!/usr/bin/env node
/**
 * rotate-splitter-converger.mjs
 *
 * 2026-05-18: 分流器/汇流器端口默认方向变更后，
 * 将 3D Top View 下的 sprite 和 mask 顺时针旋转 90°（sharp rotate=90），
 * 使图片方向与新的 registry 端口方向匹配。
 *
 * 分流器: 原 input=E(右) → 新 input=N(上)，图片中"入口"需从上转到右 (?)
 * 汇流器: 原 output=W(左) → 新 output=S(下)
 *
 * 实际上旋转方向需要使: 新sprite@rot=90 视觉效果 = 旧sprite@rot=0
 *   → 旧@0 = 新@90 = 新_rotated_CW_90
 *   → 新 = 旧_rotated_CCW_90 = sharp.rotate(270)
 *
 * 处理对象:
 *   - public/3d-top-view/sprites/*.webp  (4个)
 *   - public/3d-top-view/sprite-masks/*.webp + *.png (8个)
 * 不处理: avatar/, blueprint-view/
 */

import sharp from "sharp";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, existsSync, cpSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");

const DEVICE_IDS = [
  "item_log_splitter",
  "item_log_converger",
  "item_pipe_splitter",
  "item_pipe_converger",
];

const BACKUP_DIR = resolve(REPO_ROOT, ".temp/rotate-splitter-converger-backup");

function backupDir() {
  if (!existsSync(BACKUP_DIR)) {
    mkdirSync(BACKUP_DIR, { recursive: true });
  }
}

function backupFile(srcPath) {
  backupDir();
  const relPath = srcPath.replace(REPO_ROOT + "/", "");
  const dstPath = resolve(BACKUP_DIR, relPath);
  const dstDir = dirname(dstPath);
  if (!existsSync(dstDir)) {
    mkdirSync(dstDir, { recursive: true });
  }
  cpSync(srcPath, dstPath);
  console.log(`  backup → ${dstPath}`);
}

async function rotateImage(srcPath) {
  const image = sharp(srcPath);
  const metadata = await image.metadata();

  // sharp.rotate(270) = CCW 90°, 将图片的"右侧"转到"上方"
  // 匹配端口变更: input E(right)→N(top)
  // ensureAlpha() 保留 alpha 通道（webp mask 必须保留）
  const rotated = await image
    .ensureAlpha()
    .rotate(270)
    .toBuffer();

  // 写回原文件
  await sharp(rotated).toFile(srcPath);

  console.log(`  rotated (270°) → ${srcPath} (${metadata.width}x${metadata.height} ${metadata.format} alpha=${metadata.hasAlpha ?? false})`);
}

async function main() {
  console.log("=== 旋转 3D Top View 分流器/汇流器 Sprite & Mask ===\n");

  // 1. Sprites (webp only)
  console.log("--- Sprites ---");
  for (const id of DEVICE_IDS) {
    const spritesPath = resolve(REPO_ROOT, "public/3d-top-view/sprites", `${id}.webp`);
    if (existsSync(spritesPath)) {
      backupFile(spritesPath);
      await rotateImage(spritesPath);
    } else {
      console.log(`  SKIP (not found): ${spritesPath}`);
    }
  }

  // 2. Sprite Masks (webp + png)
  console.log("\n--- Sprite Masks ---");
  for (const id of DEVICE_IDS) {
    for (const ext of ["webp", "png"]) {
      const maskPath = resolve(REPO_ROOT, "public/3d-top-view/sprite-masks", `${id}.${ext}`);
      if (existsSync(maskPath)) {
        backupFile(maskPath);
        await rotateImage(maskPath);
      } else {
        console.log(`  SKIP (not found): ${maskPath}`);
      }
    }
  }

  console.log("\n=== 旋转完成 ===");
  console.log(`备份目录: ${BACKUP_DIR}`);
}

main().catch((err) => {
  console.error("旋转失败:", err);
  process.exit(1);
});
