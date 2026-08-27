import {
  expect,
  test as base,
  type Page,
} from "playwright/test";

export { expect };
export type { APIRequestContext, Page } from "playwright/test";

const CANVAS_LOCK_SELECTOR = '[data-sync-initial-sync-stage="canvas"]';
const REPORT_BINDING_NAME = "__reportE2eCanvasLock";
const FLUSH_BINDING_NAME = "__flushE2eCanvasLockAudit";

interface CanvasLockSnapshot {
  readonly occurredAt: string;
  readonly documentUrl: string;
  readonly phase: string | null;
  readonly currentRunReason: string | null;
  readonly initialSyncStage: string | null;
  readonly canvasLocked: boolean | null;
  readonly pendingConflictPhase: string | null;
}

interface CanvasLockObservedEvent {
  readonly kind: "lock-observed";
  readonly snapshot: CanvasLockSnapshot;
}

interface IntervalLockObservedEvent {
  readonly kind: "interval-lock-observed";
  readonly runId: string;
  readonly snapshot: CanvasLockSnapshot;
}

interface IntervalRunCompletedEvent {
  readonly kind: "interval-run-completed";
  readonly runId: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly enteredConflict: boolean;
  readonly didDownload: boolean;
  readonly didReportConflict: boolean;
  readonly endedPhase: string | null;
  readonly lockedAfterIdle: boolean;
  readonly adapterResults: readonly {
    readonly adapterId: string | null;
    readonly status: string | null;
  }[];
}

type CanvasLockAuditEvent =
  | CanvasLockObservedEvent
  | IntervalLockObservedEvent
  | IntervalRunCompletedEvent;

interface CanvasLockAuditRecord {
  readonly pageUrl: string;
  readonly event: CanvasLockAuditEvent;
}

interface CanvasLockLifecycleViolation {
  readonly kind:
    | "unexpected-lock"
    | "interval-run-incomplete"
    | "interval-run-no-effective-download"
    | "conflict-run-did-not-return-idle"
    | "canvas-still-locked-after-idle";
  readonly pageUrl: string;
  readonly runId: string | null;
  readonly detail: unknown;
}

/**
 * 所有 E2E 共用的画布锁定审计。
 * 通过 context 级 init script 覆盖默认 page、context.newPage()、刷新与跨页面导航。
 */
export const test = base.extend<{ canvasLockAudit: void }>({
  canvasLockAudit: [async ({ context }, use, testInfo) => {
    const auditRecords: CanvasLockAuditRecord[] = [];

    await context.exposeBinding(
      REPORT_BINDING_NAME,
      ({ page }: { readonly page: Page }, event: CanvasLockAuditEvent) => {
        auditRecords.push({
          pageUrl: page.url(),
          event,
        });
      },
    );
    await context.addInitScript(
      ({ bindingName, flushBindingName, selector }) => {
        interface BrowserSyncStatus {
          readonly phase?: unknown;
          readonly currentRunReason?: unknown;
          readonly initialSyncStage?: unknown;
          readonly canvasLocked?: unknown;
          readonly lastResults?: readonly {
            readonly adapterId?: unknown;
            readonly status?: unknown;
          }[];
        }

        interface BrowserSyncState {
          readonly status?: BrowserSyncStatus;
          readonly pendingConflict?: {
            readonly phase?: unknown;
          } | null;
        }

        interface ActiveIntervalRun {
          readonly runId: string;
          readonly startedAt: string;
          enteredConflict: boolean;
          completing: boolean;
        }

        const auditWindow = window as unknown as Record<string, unknown>;
        const reportedElements = new WeakSet<Element>();
        const documentAuditId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        let intervalRunSequence = 0;
        let activeIntervalRun: ActiveIntervalRun | null = null;
        let reportQueue = Promise.resolve();

        const readSyncState = (): BrowserSyncState | null => {
          const host = window.__industrialPlannerAppHost;
          return (host?.workspace?.sync?.state as BrowserSyncState | undefined) ?? null;
        };
        const toNullableString = (value: unknown): string | null =>
          typeof value === "string" ? value : null;
        const readSnapshot = (): CanvasLockSnapshot => {
          const syncState = readSyncState();
          const status = syncState?.status;
          return {
            occurredAt: new Date().toISOString(),
            documentUrl: window.location.href,
            phase: toNullableString(status?.phase),
            currentRunReason: toNullableString(status?.currentRunReason),
            initialSyncStage: toNullableString(status?.initialSyncStage),
            canvasLocked: typeof status?.canvasLocked === "boolean"
              ? status.canvasLocked
              : null,
            pendingConflictPhase: toNullableString(syncState?.pendingConflict?.phase),
          };
        };
        const reportEvent = (event: CanvasLockAuditEvent): void => {
          reportQueue = reportQueue.then(async () => {
            const reporter = auditWindow[bindingName];
            if (typeof reporter === "function") {
              await (reporter as (payload: CanvasLockAuditEvent) => Promise<void>)(event);
            }
          });
        };
        auditWindow[flushBindingName] = async (): Promise<void> => {
          await reportQueue;
        };

        const reportElement = (element: Element): void => {
          if (reportedElements.has(element)) {
            return;
          }
          reportedElements.add(element);

          const snapshot = readSnapshot();
          if (snapshot.currentRunReason !== "interval") {
            reportEvent({
              kind: "lock-observed",
              snapshot,
            });
            return;
          }

          if (activeIntervalRun === null) {
            intervalRunSequence += 1;
            activeIntervalRun = {
              runId: `${documentAuditId}:interval:${intervalRunSequence}`,
              startedAt: snapshot.occurredAt,
              enteredConflict: snapshot.pendingConflictPhase !== null,
              completing: false,
            };
          }
          reportEvent({
            kind: "interval-lock-observed",
            runId: activeIntervalRun.runId,
            snapshot,
          });
        };
        const inspectNode = (node: Node): void => {
          if (!(node instanceof Element)) {
            return;
          }
          if (node.matches(selector)) {
            reportElement(node);
          }
          for (const element of node.querySelectorAll(selector)) {
            reportElement(element);
          }
        };
        const forgetNode = (node: Node): boolean => {
          if (!(node instanceof Element)) {
            return false;
          }
          let removedReportedElement = false;
          if (node.matches(selector)) {
            removedReportedElement = reportedElements.has(node) || removedReportedElement;
            reportedElements.delete(node);
          }
          for (const element of node.querySelectorAll(selector)) {
            removedReportedElement = reportedElements.has(element) || removedReportedElement;
            reportedElements.delete(element);
          }
          return removedReportedElement;
        };
        const completeIntervalRunIfFinished = (): void => {
          const run = activeIntervalRun;
          if (run === null || run.completing) {
            return;
          }

          const syncState = readSyncState();
          if (syncState?.pendingConflict !== null && syncState?.pendingConflict !== undefined) {
            run.enteredConflict = true;
          }
          const status = syncState?.status;
          if (
            document.querySelector(selector) !== null
            || status?.currentRunReason === "interval"
            || (status?.phase !== "idle" && status?.phase !== "error")
          ) {
            return;
          }

          run.completing = true;
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              const finalStatus = readSyncState()?.status;
              const adapterResults = Array.isArray(finalStatus?.lastResults)
                ? finalStatus.lastResults.map((result) => ({
                    adapterId: toNullableString(result.adapterId),
                    status: toNullableString(result.status),
                  }))
                : [];
              reportEvent({
                kind: "interval-run-completed",
                runId: run.runId,
                startedAt: run.startedAt,
                completedAt: new Date().toISOString(),
                enteredConflict: run.enteredConflict,
                didDownload: adapterResults.some((result) => result.status === "downloaded"),
                didReportConflict: adapterResults.some((result) => result.status === "conflict"),
                endedPhase: toNullableString(finalStatus?.phase),
                lockedAfterIdle: document.querySelector(selector) !== null,
                adapterResults,
              });
              if (activeIntervalRun === run) {
                activeIntervalRun = null;
              }
            });
          });
        };

        for (const element of document.querySelectorAll(selector)) {
          reportElement(element);
        }
        const observer = new MutationObserver((records) => {
          let removedReportedElement = false;
          for (const record of records) {
            if (record.type === "attributes") {
              if (record.target instanceof Element && record.target.matches(selector)) {
                inspectNode(record.target);
              } else {
                removedReportedElement = forgetNode(record.target)
                  || removedReportedElement;
              }
              continue;
            }
            for (const node of record.addedNodes) {
              inspectNode(node);
            }
            for (const node of record.removedNodes) {
              removedReportedElement = forgetNode(node) || removedReportedElement;
            }
          }
          if (removedReportedElement) {
            completeIntervalRunIfFinished();
          }
        });
        observer.observe(document, {
          attributes: true,
          attributeFilter: ["data-sync-initial-sync-stage"],
          childList: true,
          subtree: true,
        });
      },
      {
        bindingName: REPORT_BINDING_NAME,
        flushBindingName: FLUSH_BINDING_NAME,
        selector: CANVAS_LOCK_SELECTOR,
      },
    );

    await use();

    await Promise.all(context.pages().map(async (page) => {
      await page.evaluate(async ({ flushBindingName }) => {
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        });
        const flush = (window as unknown as Record<string, unknown>)[flushBindingName];
        if (typeof flush === "function") {
          await (flush as () => Promise<void>)();
        }
      }, { flushBindingName: FLUSH_BINDING_NAME }).catch(() => undefined);
    }));

    const lifecycleViolations: CanvasLockLifecycleViolation[] = [];
    const intervalLocksByRun = new Map<string, CanvasLockAuditRecord[]>();
    const intervalCompletionByRun = new Map<string, CanvasLockAuditRecord>();

    for (const record of auditRecords) {
      if (record.event.kind === "lock-observed") {
        if (record.event.snapshot.currentRunReason !== "startup") {
          lifecycleViolations.push({
            kind: "unexpected-lock",
            pageUrl: record.pageUrl,
            runId: null,
            detail: record.event,
          });
        }
        continue;
      }
      if (record.event.kind === "interval-lock-observed") {
        const records = intervalLocksByRun.get(record.event.runId) ?? [];
        records.push(record);
        intervalLocksByRun.set(record.event.runId, records);
        continue;
      }
      intervalCompletionByRun.set(record.event.runId, record);
    }

    for (const [runId, lockRecords] of intervalLocksByRun) {
      const completionRecord = intervalCompletionByRun.get(runId);
      if (
        completionRecord === undefined
        || completionRecord.event.kind !== "interval-run-completed"
      ) {
        lifecycleViolations.push({
          kind: "interval-run-incomplete",
          pageUrl: lockRecords[0]?.pageUrl ?? "",
          runId,
          detail: lockRecords,
        });
        continue;
      }

      const completion = completionRecord.event;
      if (!completion.enteredConflict && !completion.didDownload) {
        lifecycleViolations.push({
          kind: "interval-run-no-effective-download",
          pageUrl: completionRecord.pageUrl,
          runId,
          detail: {
            lockRecords,
            completion,
          },
        });
      }
      if (completion.enteredConflict && completion.endedPhase !== "idle") {
        lifecycleViolations.push({
          kind: "conflict-run-did-not-return-idle",
          pageUrl: completionRecord.pageUrl,
          runId,
          detail: completion,
        });
      }
      if (completion.endedPhase === "idle" && completion.lockedAfterIdle) {
        lifecycleViolations.push({
          kind: "canvas-still-locked-after-idle",
          pageUrl: completionRecord.pageUrl,
          runId,
          detail: completion,
        });
      }
    }

    // AI-REMOVED 2026-08-25:
    // Reason: 单点过滤无法判断 interval 锁定最终是否进入冲突、是否实际下载，也无法验证回到 idle 后解锁。
    // Trigger: 用户确认 startup、冲突 interval、idle 解锁及空跑 interval 的四条生命周期语义。
    // Evidence: 同一次冲突同步会经历“门控 → 冲突对话框 → 门控”，旧逻辑会把两个合法门控片段都判错。
    // Replacement: 上方按 runId 聚合的 lifecycleViolations 判定。
    // Risk: Low
    // Human Review: Required
    //
    // Original code:
    // const disallowedViolations = violations.filter(
    //   ({ payload }) =>
    //     (payload as { readonly currentRunReason?: unknown }).currentRunReason !== "startup",
    // );
    // if (disallowedViolations.length === 0) {
    //   return;
    // }
    // await testInfo.attach("canvas-lock-violations", {
    //   body: JSON.stringify(disallowedViolations, null, 2),
    //   contentType: "application/json",
    // });
    // expect(
    //   disallowedViolations,
    //   `除 startup 外，E2E 全程不允许锁定画布，但观察到 ${disallowedViolations.length} 次锁定。`,
    // ).toEqual([]);
    if (lifecycleViolations.length === 0) {
      return;
    }
    await testInfo.attach("canvas-lock-violations", {
      body: JSON.stringify({
        lifecycleViolations,
        auditRecords,
      }, null, 2),
      contentType: "application/json",
    });
    expect(
      lifecycleViolations,
      `E2E 观察到 ${lifecycleViolations.length} 个不符合生命周期语义的画布锁定。`,
    ).toEqual([]);
  }, { auto: true }],
});
