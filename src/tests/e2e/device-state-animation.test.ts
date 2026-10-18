import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "./harness/fixture";
import { SCREEN_PROFILES } from "./harness/profiles";

const blueprint = JSON.parse(await readFile(
  resolve("src/tests/fixtures/blueprints/simulation/crop-cultivation/neighbors.schema7.json"), "utf8",
));

for (const profile of SCREEN_PROFILES) {
  // 2026-10-18：首帧加载与快照切换的竞态独立于屏幕尺寸，在桌面补充受控资源延迟回归。
  for (const delayInitialFrame of profile.name === "desktop" ? [false, true] : [false]) {
    test(`暂停快照切换田块形态，积水帧仍保持冻结 [${profile.name}]${delayInitialFrame ? " [首帧延迟]" : ""}`, async ({ browserSession }) => {
      test.setTimeout(120_000);
      const cli = await browserSession.openCli(profile);
      const report = await cli.runJson(`async page => {
        const errors = [];
        page.on('pageerror', error => errors.push(String(error)));
        let releaseInitialFrame = () => {};
        let initialFrameRequested = Promise.resolve();
        if (${delayInitialFrame}) {
          let recordInitialFrameRequest;
          initialFrameRequested = new Promise(resolve => { recordInitialFrameRequest = resolve; });
          const initialFrameReleased = new Promise(resolve => { releaseInitialFrame = resolve; });
          await page.route('**/3d-top-view/animations/soil_corp_cabbage_1/mature-0.webp', async route => {
            recordInitialFrameRequest();
            await initialFrameReleased;
            await route.continue();
          });
        }
        try {
          await page.goto('http://127.0.0.1:4174/');
          await page.waitForFunction(() => window.__test__?.readiness().canvasAttached && window.__test__?.readiness().viewportValid);
          await page.evaluate(input => window.__test__.loadBlueprint(input), ${JSON.stringify(blueprint)});
          await page.evaluate(() => window.__test__.focusEntity('A'));
          await page.evaluate(async () => {
            const { runInAction } = await import('/node_modules/.vite/deps/mobx.js');
            const host = window.__industrialPlannerAppHost;
            runInAction(() => {
              host.internalState.settings.gamePlayDeviceAnimations = true;
              host.internalState.settings.gameUseBlueprintStyleDeviceImages = false;
            });
            await host.workspace.simulation.actions.start();
            host.workspace.simulation.actions.pause();
          });
          if (${delayInitialFrame}) {
            await initialFrameRequested;
            await page.waitForFunction(() => [...window.__industrialPlannerAppHost.workspace.render.textureManager.deviceAnimations.sessions]
              .some(session => session.asset.spriteId === 'soil_corp_cabbage_1' && session.phase === 'mature' && session.retainedPages.size > 0));
          }
          // 读取实际挂载 Sprite 的帧，不用 Node 中的播放器状态代替画面验证。
          const sample = () => page.evaluate(() => {
            const render = window.__industrialPlannerAppHost.workspace.render;
            const phases = new Map();
            for (const asset of render.textureManager.deviceAnimations.resolvedAssets) {
              if (asset.spriteId !== 'soil_corp_cabbage_1') continue;
              for (const [clip, pages] of Object.entries(asset.pages)) for (const page of pages) {
                if (page.texture) phases.set(page.texture.source, clip);
              }
            }
            const frames = [];
            const visit = (node, visible) => {
              visible = visible && node.visible !== false && node.renderable !== false;
              const clip = visible && phases.get(node.texture?.source);
              if (clip) frames.push({ clip, x: node.texture.frame.x, y: node.texture.frame.y });
              if (visible) for (const child of node.children ?? []) visit(child, visible);
            };
            visit(render.app.stage, true);
            return frames;
          });
          const seek = second => page.evaluate(async second => {
            const simulation = window.__industrialPlannerAppHost.workspace.simulation;
            const result = await simulation.internalActions.syncToTick(second * simulation.topology.getSnapshot().standardTickRate + 1);
            if (result.status !== 'ready') throw Error(JSON.stringify(result));
            return simulation.queries.getDeviceRuntimeStatus('A').deviceState;
          }, second);
          const waitClip = async clip => {
            const deadline = Date.now() + 20000;
            while (Date.now() < deadline) {
              const frames = await sample();
              if (frames.some(frame => frame.clip === clip)) return frames;
              await page.waitForTimeout(50);
            }
            throw Error('田块实际纹理未切换到 ' + clip + ': ' + JSON.stringify(await sample()));
          };
          const ordinary = await seek(45);
          if (${delayInitialFrame}) {
            await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(null)))));
            releaseInitialFrame();
          }
          await waitClip('seedling_water');
          const refined = await seek(95);
          const selected = (await waitClip('variant_water')).filter(frame => frame.clip === 'variant_water');
          await page.waitForTimeout(220);
          const frozen = (await sample()).filter(frame => frame.clip === 'variant_water');
          await page.screenshot({ path: ${JSON.stringify(resolve(cli.directory, "paused-refined-water.png"))} });
          return { ordinary, refined, selected, frozen, errors };
        } finally { releaseInitialFrame(); }
      }`, "paused-state-animation.log") as {
        ordinary: { visualKey: string; timerStartedAtSeconds: number };
        refined: { visualKey: string; timerStartedAtSeconds: number };
        selected: Array<{ clip: string; x: number; y: number }>;
        frozen: Array<{ clip: string; x: number; y: number }>;
        errors: string[];
      };
      expect(report.ordinary.visualKey).toBe("irrigated");
      expect(report.refined.visualKey).toBe("refined-irrigated");
      expect(report.refined.timerStartedAtSeconds).toBe(report.ordinary.timerStartedAtSeconds);
      expect(report.selected).toEqual(report.frozen);
      expect(report.errors).toEqual([]);
    });
  }
}
