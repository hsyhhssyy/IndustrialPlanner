import { beginDataMigration, isDataMigrationComplete, writeDataMigrationCompletion } from "./storage/data-migration-state";
import { RECOVERY_LOCK } from "./storage/storage-generation";

export interface DataMigrationJob {
  readonly label: string;
  readonly run: () => Promise<void>;
}

export interface DataMigrationPlan {
  readonly jobs: readonly DataMigrationJob[];
  /** 无旧内容的新安装仍需建立资源初始化记录，不显示进度遮罩。 */
  readonly finish?: () => Promise<void>;
}

export interface DataMigrationParticipant {
  readonly label?: string;
  readonly prepare: () => Promise<DataMigrationPlan>;
  readonly pause?: () => Promise<void>;
  readonly refresh?: () => Promise<void>;
  readonly resume?: () => void;
}

export interface DataMigrationProgress {
  readonly phase: "idle" | "checking" | "pausing" | "migrating" | "committing" | "failed";
  readonly visible: boolean;
  readonly completed: number;
  readonly total: number;
  readonly label: string;
  readonly error: string | null;
}

const idle: DataMigrationProgress = { phase: "idle", visible: false, completed: 0, total: 0, label: "", error: null };
let state = idle;
const listeners = new Set<() => void>();
let controller: ReturnType<typeof createDataMigrationController> | null = null;

export const readDataMigrationProgress = (): DataMigrationProgress => state;
export function subscribeDataMigration(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function isDataMigrationFrozen(): boolean { return state.phase !== "idle"; }
export function hasDataMigrationController(): boolean { return controller !== null; }
export function assertDataMigrationIdle(): void {
  if (isDataMigrationFrozen()) throw new Error("正在升级本地数据，请等待升级完成。");
}

function publish(next: DataMigrationProgress): void {
  state = next;
  for (const listener of listeners) listener();
}

/** 组合根注入资源 owner；共享调度器不引用任何业务模块。 */
export function createDataMigrationController(version: string, participants: readonly DataMigrationParticipant[]) {
  let running: Promise<void> | null = null;
  const execute = async (incoming: readonly DataMigrationJob[], force: boolean): Promise<void> => {
    if (!force && incoming.length === 0 && await isDataMigrationComplete(version)) return;
    publish({ ...idle, phase: "checking", visible: incoming.length > 0 });
    try {
      // 运行时输入先结算全部业务活动；启动时 Host 尚未创建，pause 是空操作。
      for (const participant of participants) await participant.pause?.();
      await beginDataMigration(version);
      if (incoming.length > 0) {
        await writeDataMigrationCompletion(version, false);
        publish({ ...idle, phase: "migrating", visible: true, total: incoming.length, label: incoming[0]!.label });
        for (const job of incoming) { await job.run(); publish({ ...state, completed: state.completed + 1 }); }
      }
      const plans: DataMigrationPlan[] = [];
      for (const participant of participants) {
        if (participant.label) publish({ ...state, phase: "checking", label: participant.label });
        plans.push(await participant.prepare());
      }
      const jobs = plans.flatMap(plan => plan.jobs);
      if (jobs.length > 0) {
        await writeDataMigrationCompletion(version, false);
        publish({ ...state, phase: "migrating", visible: true, total: incoming.length + jobs.length });
        for (const job of jobs) {
          publish({ ...state, label: job.label });
          // 让浏览器在每项之间提交进度帧；不阻塞长任务前的首次绘制。
          await new Promise<void>(resolve => setTimeout(resolve, 0));
          await job.run();
          publish({ ...state, completed: state.completed + 1 });
        }
      }
      publish({ ...state, phase: "committing" });
      for (const plan of plans) await plan.finish?.();
      for (const participant of participants) await participant.refresh?.();
      await writeDataMigrationCompletion(version, true);
      publish(idle);
      for (const participant of [...participants].reverse()) participant.resume?.();
    } catch (error) {
      publish({ ...state, phase: "failed", visible: true, error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  };
  return {
    run(incoming: readonly DataMigrationJob[] = [], force = false, ownsSyncLock = false): Promise<void> {
      // 新输入不能被已有扫描吞掉；排在前一轮之后，失败则保留冻结。
      // 固定锁顺序：同步批次 → 生命周期。同步批次内部直接继承外层锁，避免自等待。
      const previous = running;
      const lifecycle = async (): Promise<void> => {
        if (globalThis.navigator?.locks) await navigator.locks.request(RECOVERY_LOCK, { mode: "exclusive" }, () => execute(incoming, force));
        else { await previous; await execute(incoming, force); }
      };
      const task = (async (): Promise<void> => {
        if (!ownsSyncLock && globalThis.navigator?.locks) await navigator.locks.request("sync-service", { mode: "exclusive" }, lifecycle);
        else await lifecycle();
      })();
      running = task;
      void task.finally(() => { if (running === task) running = null; }).catch(() => undefined);
      return task;
    },
  };
}

export function installDataMigrationController(value: ReturnType<typeof createDataMigrationController>): () => void {
  controller = value;
  return () => { if (controller === value) { controller = null; publish(idle); } };
}

/** 只有已采纳的输入调用此入口；预览、系统静态蓝图不使本地标记失效。 */
export async function migrateIncomingData(jobs: readonly DataMigrationJob[], ownsSyncLock = false): Promise<void> {
  if (jobs.length === 0) return;
  if (controller === null) {
    // 无头工具没有工作台生命周期，输入仍由原有显式转换调用者负责。
    for (const job of jobs) await job.run();
    return;
  }
  await controller.run(jobs, true, ownsSyncLock);
}
