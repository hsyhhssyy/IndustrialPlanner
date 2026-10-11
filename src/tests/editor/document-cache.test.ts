import { runInAction } from "mobx";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createEditorHost } from "@/editor/editor-host";
import type { EditorDocumentRepositoryOptions } from "@/editor/document-repository";
import { regionalSimulationUiState } from "@/app/state/regional-simulation-ui-state";
import { createAppTestWorkspace } from "../helpers/app-test-workspace";
import { createFakeIndexedDbFactory } from "../shared/fake-indexed-db";

beforeEach(() => { vi.stubGlobal("indexedDB", createFakeIndexedDbFactory()); });
afterEach(() => {
  runInAction(() => { regionalSimulationUiState.reset(); });
  localStorage.clear(); vi.unstubAllGlobals();
});

it("真实 App/Editor 切换基地保留未落盘编辑，关闭多基地后等待保存再释放缓存", async () => {
  const initial = createAppTestWorkspace();
  await initial.app.regionalSettings.hydrate();
  let editor = createEditorHost(initial.workspace);
  let app = initial.app;
  let release = () => {};
  try {
    await editor.internalDocuments.ready();
    runInAction(() => { regionalSimulationUiState.experimentalEnabled = true; });
    app.regionalSettings.setMultiBaseEnabled(true);
    const current = editor.document.getSnapshot().baseId;
    const tag = initial.workspace.registry.baseDefinitions.find(base => base.id === current)!.tag;
    const bases = initial.workspace.registry.baseDefinitions.filter(base => base.tag === tag).map(base => base.id).sort();
    const cached = () => editor.internalDocuments.snapshots().map(snapshot => snapshot.baseId).sort();
    await vi.waitFor(() => expect(cached()).toEqual(bases));
    await editor.internalDocuments.flush();
    const options = (editor.internalDocuments as unknown as { options: EditorDocumentRepositoryOptions }).options;
    const read = options.read, write = options.write;
    const reads: string[] = [];
    let saveStarted = false;
    const gate = new Promise<void>(resolve => { release = resolve; });
    // 与原 E2E 相同，仅在真实 I/O 边界延迟首轮写入并记录读取。
    Object.assign(options, {
      read: async (baseId: string) => { reads.push(baseId); return read(baseId); },
      write: async (...args: Parameters<typeof write>) => {
        if (!saveStarted) { saveStarted = true; await gate; }
        return write(...args);
      },
    });
    editor.actions.writeDocumentSettings({ powerMode: "real" });
    await vi.waitFor(() => expect(saveStarted).toBe(true));
    const other = bases.find(baseId => baseId !== current)!;
    expect(other).toBeDefined();
    await editor.actions.loadLatestBaseDocument(other);
    await editor.actions.loadLatestBaseDocument(current);
    expect(reads).toEqual([]);
    expect(editor.document.getSnapshot().documentSettings.powerMode).toBe("real");
    app.regionalSettings.setMultiBaseEnabled(false);
    expect(app.state.settings.regionalMultiBaseEnabled).toBe(false);
    expect(cached()).toEqual(bases);
    release();
    await editor.internalDocuments.flush();
    await vi.waitFor(() => expect(cached()).toEqual([current]));
    editor.dispose(); app.dispose();
    const restored = createAppTestWorkspace();
    app = restored.app;
    await app.regionalSettings.hydrate();
    editor = createEditorHost(restored.workspace);
    await editor.internalDocuments.ready();
    await editor.internalDocuments.flush();
    await vi.waitFor(() => expect(cached()).toEqual([current]));
    expect(app.state.settings.regionalMultiBaseEnabled).toBe(false);
    expect(editor.document.getSnapshot().documentSettings.powerMode).toBe("real");
  } finally { release(); await editor.internalDocuments.flush(); editor.dispose(); app.dispose(); }
});
