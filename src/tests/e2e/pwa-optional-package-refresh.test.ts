import { startPwaPackageServer, OPTIONAL_PACKAGE_FIXTURE_URLS } from "./harness/pwa-package-server";
import { expect, test, SCREEN_PROFILES } from "./harness/fixture";

interface PackageAudit {
  bodyReads: number;
  resourceWrites: number;
}

interface PackageSnapshot {
  requests: string[];
  progress: { task: string; completedFiles: number }[];
  complete: boolean;
}

// 开发期已用真实产品和 SW 串行验证三档环境；本用例独立验证离线包协议与实际缓存。
test.use({ appServer: false });

for (const profile of SCREEN_PROFILES) {
  test(`完整动画和音频包刷新静默恢复，缓存丢失只补缺失文件 [${profile.name}]`, async ({ browserSession, round }) => {
    test.setTimeout(90_000);
    const server = await startPwaPackageServer();
    round.ports.add(Number(new URL(server.origin).port));
    try {
      const cli = await browserSession.openCli(profile);
      const report = await cli.runJson(`async page => {
        const urls = ${JSON.stringify(OPTIONAL_PACKAGE_FIXTURE_URLS)};
        const origin = ${JSON.stringify(server.origin)};
        const ready = () => page.waitForFunction(() => navigator.serviceWorker.controller?.state === 'activated');
        const start = async task => {
          await page.locator('#' + task).click();
          await page.waitForFunction(task => window.__pwaMessages.some(message =>
            message.type === 'PWA_PRECACHE_DONE' && message.task === task), task);
        };
        const reset = () => page.evaluate(async () => {
          window.__pwaMessages = [];
          await fetch('/__test/reset');
        });
        const snapshot = () => page.evaluate(async () => {
          const state = await (await fetch('/__test/stats')).json();
          const names = await caches.keys();
          let complete = true;
          for (const task of ['animation', 'audio']) {
            const name = names.find(name => name.startsWith('industrial-planner-' + task + '-precache-'));
            if (!name || !await (await caches.open(name)).match('__industrial_planner_' + task + '_complete__.json')) complete = false;
          }
          return { requests: state.requests, complete, progress: window.__pwaMessages.filter(message =>
            message.type === 'PWA_PRECACHE_PROGRESS' && message.task !== 'core') };
        });
        const audit = async () => {
          await page.evaluate(() => {
            window.__pwaMessages = window.__pwaMessages.filter(message => message.type !== 'TEST_AUDIT');
            navigator.serviceWorker.controller.postMessage({type:'TEST_AUDIT'});
          });
          await page.waitForFunction(() => window.__pwaMessages.some(message => message.type === 'TEST_AUDIT'));
          return page.evaluate(() => window.__pwaMessages.find(message => message.type === 'TEST_AUDIT'));
        };
        await page.goto(origin);
        await ready();
        await start('animation');
        await start('audio');
        const installed = await snapshot();
        const before = await audit();

        await reset();
        await page.reload();
        await ready();
        await start('animation');
        await start('audio');
        const cached = await snapshot();
        const after = await audit();

        await page.evaluate(async () => {
          const name = (await caches.keys()).find(name => name.startsWith('industrial-planner-audio-precache-'));
          await (await caches.open(name)).delete('__industrial_planner_audio_complete__.json');
        });
        await reset();
        await start('audio');
        const legacy = await snapshot();
        const afterLegacy = await audit();

        await page.evaluate(async urls => {
          const names = await caches.keys();
          for (const task of ['animation', 'audio']) {
            const name = names.find(name => name.startsWith('industrial-planner-' + task + '-precache-'));
            await (await caches.open(name)).delete(urls[task][0]);
          }
        }, urls);
        await reset();
        await start('animation');
        await start('audio');
        const repaired = await snapshot();
        return { installed, cached, legacy, repaired, before, after, afterLegacy };
      }`, "optional-package-refresh.log") as {
        installed: PackageSnapshot;
        cached: PackageSnapshot;
        legacy: PackageSnapshot;
        repaired: PackageSnapshot;
        before: PackageAudit;
        after: PackageAudit;
        afterLegacy: PackageAudit;
      };

      expect(report.installed.complete).toBe(true);
      expect(report.installed.requests.sort()).toEqual([...OPTIONAL_PACKAGE_FIXTURE_URLS.animation, ...OPTIONAL_PACKAGE_FIXTURE_URLS.audio].sort());
      expect(report.cached).toMatchObject({ complete: true, requests: [], progress: [] });
      expect(report.after.bodyReads).toBe(report.before.bodyReads);
      expect(report.after.resourceWrites).toBe(report.before.resourceWrites);
      expect(report.legacy).toMatchObject({ complete: true, requests: [], progress: [] });
      expect(report.afterLegacy.resourceWrites).toBe(report.after.resourceWrites);
      expect(report.repaired.complete).toBe(true);
      expect(report.repaired.requests.sort()).toEqual([OPTIONAL_PACKAGE_FIXTURE_URLS.animation[0], OPTIONAL_PACKAGE_FIXTURE_URLS.audio[0]].sort());
      for (const task of ["animation", "audio"]) {
        expect(report.repaired.progress).toContainEqual(expect.objectContaining({ task, completedFiles: 1 }));
      }
    } finally {
      await server.close();
    }
  });
}
