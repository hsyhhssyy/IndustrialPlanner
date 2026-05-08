import { describe, expect, it } from "vitest";

import { getBlueprintLibraryDescriptor } from "@/shared/blueprints/blueprint-library";

describe("blueprint-library", () => {
  it("marks system blueprints as read-only and user blueprints as editable", () => {
    const systemLibrary = getBlueprintLibraryDescriptor("system");
    const userLibrary = getBlueprintLibraryDescriptor("user");

    expect(systemLibrary.isReadOnly).toBe(true);
    expect(systemLibrary.canCreateFolders).toBe(false);
    expect(userLibrary.isReadOnly).toBe(false);
    expect(userLibrary.canCreateFolders).toBe(true);
  });
});