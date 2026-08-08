import { expect, test } from "playwright/test";

test("collects main and Dedicated Worker logs and keeps them across refresh", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto("/");
  await page.getByTitle("设置").click();
  const debugModeToggle = page.locator('input[name="other-debug-mode"]');
  await expect(debugModeToggle).toBeVisible();
  await debugModeToggle.check({ force: true });
  await expect(debugModeToggle).toBeChecked();
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByTitle("调试日志").click();

  await page.evaluate(() => {
    console.warn("main collector e2e smoke");
  });

  const textarea = page.getByRole("textbox", { name: "调试日志" });
  await expect(textarea).toBeVisible();
  await expect.poll(async () => await textarea.inputValue()).toContain(
    "main collector e2e smoke",
  );

  await page.evaluate(async () => {
    const moduleUrl = new URL(
      "/src/shared/worker/attach-worker-runtime.ts",
      window.location.href,
    ).href;
    const workerRuntime = await import(moduleUrl) as {
      attachWorkerRuntime(worker: Worker, kind: "webdav"): { dispose(): void };
    };
    const worker = new Worker(
      new URL("/src/sync/clients/webdav/webdav-worker.ts", window.location.href),
      { type: "module" },
    );
    const attachment = workerRuntime.attachWorkerRuntime(worker, "webdav");
    const testWindow = window as typeof window & {
      __debugLogTestWorker?: Worker;
      __debugLogTestAttachment?: { dispose(): void };
    };
    testWindow.__debugLogTestWorker = worker;
    testWindow.__debugLogTestAttachment = attachment;
    worker.postMessage({
      requestId: 1,
      clientOptions: { baseUrl: window.location.origin },
      operation: {
        type: "read-text-file",
        relativePath: "collector-e2e-missing.json",
        options: {},
      },
    });
  });

  await expect.poll(async () => await textarea.inputValue()).toContain(
    "[webdav:webdav-",
  );
  await expect.poll(async () => await textarea.inputValue()).toContain(
    "GET collector-e2e-missing.json → started",
  );

  await expect.poll(async () => await page.evaluate(() =>
    Object.values(localStorage).some((value) => value.includes('"debugMode":true')),
  )).toBe(true);
  await page.reload();

  const reloadedTextarea = page.getByRole("textbox", { name: "调试日志" });
  await expect(reloadedTextarea).toBeVisible();
  await expect.poll(async () => await reloadedTextarea.inputValue()).toContain(
    "main collector e2e smoke",
  );
  await expect.poll(async () => await reloadedTextarea.inputValue()).toContain(
    "GET collector-e2e-missing.json → started",
  );
});
