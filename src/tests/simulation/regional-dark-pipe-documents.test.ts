import { describe, expect, it } from "vitest";
import { createBlueprintDocument } from "@/domain/document/blueprint-document";
import { createRegistryContract } from "@/registry";
import { normalizeWorldDocument } from "@/shared/storage/world-document-storage";
import { createDenseRegionalDocument } from "@/simulation/dense/dense-regional-document";
import { runBlueprintSimulation } from "./blueprint-runner";
import inletJson from "../fixtures/blueprints/simulation/dense-host-regressions/throughput-inlet.world.schema6.json";
import outletJson from "../fixtures/blueprints/simulation/dense-host-regressions/throughput-outlet.world.schema6.json";
import blockedInletJson from "../fixtures/blueprints/simulation/dense-host-regressions/throughput-blocked-inlet.world.schema6.json";
import blockedJson from "../fixtures/blueprints/simulation/dense-host-regressions/throughput-blocked-outlet.world.schema6.json";

describe("文档跨基地暗管的 Dense 执行", () => {
  it.each([
    { name: "正常出口", inlet: inletJson, outlet: outletJson, expected: 120 },
    { name: "堵塞出口", inlet: blockedInletJson, outlet: blockedJson, expected: 0 },
  ])("$name：物化后保留每分钟吞吐与背压", async ({ inlet, outlet, expected }) => {
    const documents = [normalizeWorldDocument(inlet)!, normalizeWorldDocument(outlet)!];
    const registry = createRegistryContract();
    const composite = createDenseRegionalDocument({ documents, registry });
    const report = await runBlueprintSimulation({
      // 将生产合图结果交给已有真实引擎测试入口；外部引用此时已经解为本地执行端点。
      blueprint: createBlueprintDocument({
        ...composite, baseId: documents[0]!.baseId, name: "跨基地暗管运行", version: "fixture-v1",
        initialGridPoint: { x: 0, y: 0 },
      }),
      maxDurationSeconds: 140, engineKind: "dense-v2", registry,
    });
    const end = report.ticks.at(-1)!.elapsedSimulationSeconds;
    const window = report.ticks.filter(tick => tick.elapsedSimulationSeconds > end - 60);
    const outputCount = window.flatMap(tick => tick.transfers).reduce((total, transfer) =>
      transfer.sourceSlotId.includes("dense-base:wuling_tianwangping_aid:outlet/") ? total + transfer.amount : total, 0);
    expect(outputCount).toBe(expected);
    if (expected === 0) {
      const inputCount = window.flatMap(tick => tick.transfers).reduce((total, transfer) =>
        transfer.sourceSlotId.includes("dense-base:wuling_protocol_core:source/") ? total + transfer.amount : total, 0);
      expect(inputCount).toBe(0);
      const source = report.summary.deviceInventoryChanges.find(device => device.deviceId.endsWith(":source"))!;
      expect(source.slotChanges.some(slot => slot.finalCount > 0)).toBe(true);
    }
    expect(report.summary.runtimeDiagnosticCount).toBe(0);
  });

  it("单基地执行忽略远端引用，不能按本地实体 ID 解引用", () => {
    const document = normalizeWorldDocument(outletJson)!;
    const composite = createDenseRegionalDocument({ documents: [document], registry: createRegistryContract() });
    expect(document.slotLinks).toHaveLength(1);
    expect(composite.slotLinks).toEqual([]);
  });
});
