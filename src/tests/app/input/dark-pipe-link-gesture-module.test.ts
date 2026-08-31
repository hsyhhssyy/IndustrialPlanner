import { afterEach, describe, expect, it } from "vitest";
import { runInAction } from "mobx";

import { createAppHost, type AppHost } from "@/app/host/app-host";
import {
  createHypergryphDarkPipeLinkGestureModule,
  type GestureActionContext,
} from "@/app/input/gesture/actions";
import type { KeyboardSnapshot } from "@/app/input/gesture/adapter";
import { createDummyWorldDocument } from "@/tests/helpers/dummy-document";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import type { WorldDocument, WorldEntity } from "@/domain/document/world-document";
import { createEditorHost, type EditorHost } from "@/editor/editor-host";
import { createRegistryContract } from "@/registry";
import { handleKeyboardShortcutThroughRouter } from "./shortcut-route-test-helper";

const disposers: Array<() => void> = [];

afterEach(() => {
  while (disposers.length > 0) {
    disposers.pop()?.();
  }
  localStorage.clear();
});

describe("createHypergryphDarkPipeLinkGestureModule", () => {
  it("creates a dark pipe link from a candidate tap and exits the temporary tool", () => {
    const { appHost, context, editorHost } = createContext();
    const module = createHypergryphDarkPipeLinkGestureModule();

    editorHost.internalDocument.setSnapshot(createDocument([
      entity("inlet", "udpipe_loader_1"),
      entity("outlet", "udpipe_unloader_1"),
    ]));
    enterDarkPipeLinkTool(appHost);

    const result = module.handle({
      type: "mouse tap",
      gestureId: "dark-pipe-link-tap",
      button: 0,
      buttons: 0,
      position: { x: 10, y: 10 },
      longPress: false,
      pointerEntity: entity("outlet", "udpipe_unloader_1"),
      modifiers: emptyModifiers(),
      sourceEvent: null,
    }, context);

    expect(result).toEqual({ status: "handled" });
    expect(appHost.state.activeTool).toBe("select");
    expect(appHost.state.toolInfo.darkPipeLink).toBeNull();
    expect(editorHost.document.getSnapshot().slotLinks).toEqual([
      expect.objectContaining({
        id: "dark-pipe-link:outlet:inlet",
        linkType: "share-all",
      }),
    ]);
  });

  it("cancels the temporary tool on Escape", () => {
    const { appHost, context } = createContext();
    const module = createHypergryphDarkPipeLinkGestureModule();
    enterDarkPipeLinkTool(appHost);

    expect(handleKeyboardShortcutThroughRouter({
      module,
      context,
      event: {
        type: "key down",
        gestureId: "dark-pipe-link-escape",
        code: "Escape",
        key: "Escape",
        keyCode: 27,
        modifiers: emptyModifiers(),
        sourceEvent: null,
      },
    })).toEqual({ status: "handled" });
    expect(appHost.state.activeTool).toBe("select");
    expect(appHost.state.toolInfo.darkPipeLink).toBeNull();
  });
});

function createContext(): {
  appHost: AppHost;
  context: GestureActionContext<AppHost>;
  editorHost: EditorHost;
} {
  const workspace: WorkspaceContract = {
    state: createWorkspaceState(),
    registry: createRegistryContract(),
    app: null,
    editor: null,
    render: null,
    simulation: null,
    sync: null,
  };
  const editorHost = createEditorHost(workspace);
  const appHost = createAppHost(workspace);
  disposers.push(() => appHost.dispose(), () => editorHost.dispose());

  return {
    appHost,
    editorHost,
    context: {
      appHost,
      workspace,
      keyboard: emptyKeyboard(),
    },
  };
}

function createDocument(entities: readonly WorldEntity[]): WorldDocument {
  const document = createDummyWorldDocument();
  document.entities = Object.fromEntries(entities.map((candidate) => [candidate.id, candidate]));
  document.entityOrder = entities.map((candidate) => candidate.id);
  document.slotLinks = [];
  return document;
}

function entity(id: string, definitionId: string): WorldEntity {
  return {
    id,
    definitionId,
    position: { x: 0, y: 0 },
    rotation: 0,
    config: {},
    tags: [],
  };
}

function enterDarkPipeLinkTool(appHost: AppHost): void {
  runInAction(() => {
    appHost.internalState.toolInfo.darkPipeLink = {
      sourceEntityId: "inlet",
      sourceRole: "inlet",
      candidateEntityIds: ["outlet"],
      returnTool: "select",
    };
  });
  appHost.internalActions.setActiveTool("dark-pipe-link");
}

function emptyKeyboard(): KeyboardSnapshot {
  return {
    pressedKeys: new Set(),
    lastCode: null,
    lastKey: null,
    lastKeyCode: null,
    modifiers: emptyModifiers(),
  };
}

function emptyModifiers() {
  return {
    alt: false,
    ctrl: false,
    meta: false,
    shift: false,
  };
}
