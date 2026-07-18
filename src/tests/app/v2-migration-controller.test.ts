// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AppHost } from "@/app/host/app-host";
import { V2MigrationController } from "@/app/migration";
import { V2_MODULE_BALANCING_MODULES_LOCAL_STORAGE_KEY } from "@/app/migration/v2-migration-keys";
import { executeV2Migration } from "@/app/migration/v2-migration-executor";

vi.mock("@/app/migration/v2-migration-executor", () => ({
  executeV2Migration: vi.fn(),
}));

const migrationResult = {
  migratedMapCount: 1,
  migratedBlueprintCount: 2,
  migratedModuleCanvasCount: 3,
  migratedCustomModuleCount: 4,
  loadedBaseId: null,
};

describe("V2MigrationController", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(
      V2_MODULE_BALANCING_MODULES_LOCAL_STORAGE_KEY,
      JSON.stringify([]),
    );
    vi.mocked(executeV2Migration).mockReset();
    vi.mocked(executeV2Migration).mockResolvedValue(migrationResult);
  });

  it("closes the first-use automatic dialog after a successful migration", async () => {
    const controller = new V2MigrationController();

    controller.initialize();

    expect(controller.dialogState.visible).toBe(true);

    await controller.runMigration({} as AppHost);

    expect(controller.phase).toBe("completed");
    expect(controller.dialogState.visible).toBe(false);
  });

  it("keeps a manually opened dialog visible after a successful migration", async () => {
    const controller = new V2MigrationController();

    controller.openDialog();

    expect(controller.dialogState.visible).toBe(true);

    await controller.runMigration({} as AppHost);

    expect(controller.phase).toBe("completed");
    expect(controller.dialogState.visible).toBe(true);
  });

  it("persists dismissal across reloads and still allows reopening from settings", () => {
    const controller = new V2MigrationController();

    controller.initialize();
    expect(controller.dialogState.visible).toBe(true);

    controller.closeDialog();

    const reloadedController = new V2MigrationController();
    reloadedController.initialize();

    expect(reloadedController.migrationState.dismissedAt).not.toBeNull();
    expect(reloadedController.dialogState.visible).toBe(false);

    reloadedController.openDialog();

    expect(reloadedController.dialogState.visible).toBe(true);
  });

  it("does not auto-close after the automatic dialog is dismissed and reopened manually", async () => {
    const controller = new V2MigrationController();

    controller.initialize();
    controller.closeDialog();
    controller.openDialog();

    expect(controller.dialogState.visible).toBe(true);

    await controller.runMigration({} as AppHost);

    expect(controller.phase).toBe("completed");
    expect(controller.dialogState.visible).toBe(true);
  });
});
