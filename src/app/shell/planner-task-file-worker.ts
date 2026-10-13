import { cloneCompactPlannerTask } from "@/shared/planner-task-memory";

// 只接收一次导入；大文本和解析树均随调用方终止 Worker 释放。
self.onmessage = async (event: MessageEvent<{ file: Blob; itemIds: string[] }>) => {
  try {
    const value: unknown = JSON.parse(await event.data.file.text());
    self.postMessage({ value: cloneCompactPlannerTask(value, event.data.itemIds) });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
