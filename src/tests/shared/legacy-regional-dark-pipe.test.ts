import { describe, expect, it } from "vitest";
import { createWorldDocument } from "@/domain/document/world-document";
import { normalizeBlueprintDocument } from "@/shared/blueprints/blueprint-document-codec";
import { createDarkPipeSlotLink, createRegionalDarkPipeLink } from "@/shared/dark-pipe-link";
import { planLegacyRegionalDarkPipeMigration, readLegacyRegionalDarkPipeAsset } from "@/shared/legacy-regional-dark-pipe";
import fixtureJson from "../fixtures/blueprints/editor-regional-dark-pipe/scene.schema6.json";

const blueprint = normalizeBlueprintDocument(fixtureJson)!;
const bases = [{ id: "inlet-base", tag: "武陵" }, { id: "outlet-base", tag: "武陵" }];
const link = createRegionalDarkPipeLink({
  inlet: { baseId: "inlet-base", entityId: "inlet" },
  outlet: { baseId: "outlet-base", entityId: "outlet" },
});
const raw = { _v: 2, data: { schemaVersion: 2, regions: { 武陵: { resources: [] } }, darkPipeLinks: [link] } };
const documents = () => bases.map(base => ({
  ...createWorldDocument({ baseId: base.id }), entities: structuredClone(blueprint.entities),
  entityOrder: [...blueprint.entityOrder], slotLinks: [...blueprint.slotLinks],
}));

describe("旧 App 暗管关系迁入世界文档", () => {
  it("只在出口持有关系并清除所连接出口的仓库来源，源对象及其他出口不变", () => {
    const source = documents();
    const before = JSON.stringify(source);
    const plan = planLegacyRegionalDarkPipeMigration({ asset: readLegacyRegionalDarkPipeAsset(raw)!, documents: source, bases });
    expect(plan.changed).toBe(true);
    expect(plan.diagnostics).toEqual([]);
    expect(plan.nextAsset.data.darkPipeLinks).toEqual([]);
    expect(Reflect.get(plan.nextAsset.data, "regions")).toEqual(raw.data.regions);
    expect(plan.changes[0]!.after.slotLinks).toEqual(blueprint.slotLinks);
    expect(plan.changes[1]!.after.slotLinks.map(link => link.id)).toEqual(["warehouse-other-outlet", link.id]);
    expect(plan.changes[1]!.after.slotLinks.at(-1)!.target.baseId).toBe("inlet-base");
    expect(plan.changes[1]!.after.entities.outlet!.config).toEqual({});
    expect(plan.changes[0]!.after.entities.inlet!.config).toEqual({});
    expect(JSON.stringify(source)).toBe(before);
  });

  it("重复到达的同一旧记录只移除旧记录，不重复写入或重置端点", () => {
    const first = planLegacyRegionalDarkPipeMigration({ asset: readLegacyRegionalDarkPipeAsset(raw)!, documents: documents(), bases });
    const migrated = first.changes.map(change => change.after);
    const second = planLegacyRegionalDarkPipeMigration({ asset: readLegacyRegionalDarkPipeAsset(raw)!, documents: migrated, bases });
    expect(second.changed).toBe(true);
    expect(second.nextAsset.data.darkPipeLinks).toEqual([]);
    expect(second.changes.every(change => change.before === change.after)).toBe(true);
    expect(readLegacyRegionalDarkPipeAsset(second.nextAsset)).toBeNull();
  });

  it("缺失端点、跨区域和本地占用保留旧记录并产生诊断", () => {
    for (const scenario of ["missing", "region", "local"] as const) {
      const source = documents();
      const definitions = bases.map(base => ({ ...base }));
      if (scenario === "missing") source[0]!.entities = {};
      if (scenario === "region") definitions[1]!.tag = "四号谷地";
      if (scenario === "local") source[0]!.slotLinks.push(createDarkPipeSlotLink({ inletEntityId: "inlet", outletEntityId: "outlet" }));
      const plan = planLegacyRegionalDarkPipeMigration({ asset: readLegacyRegionalDarkPipeAsset(raw)!, documents: source, bases: definitions });
      expect(plan.changed).toBe(false);
      expect(plan.nextAsset.data.darkPipeLinks).toEqual([link]);
      expect(plan.diagnostics).toHaveLength(1);
      expect(plan.changes.every(change => change.before === change.after)).toBe(true);
    }
  });
});
