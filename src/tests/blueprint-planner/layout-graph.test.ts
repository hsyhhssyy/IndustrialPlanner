import { describe, expect, it } from "vitest";
import { buildLayoutGraph } from "@/blueprint-planner/layout-graph";

describe("生产网络布局分组", () => {
  it("保留互相嵌套的回流，并在不同循环之间排列上游和下游", () => {
    const graph = buildLayoutGraph(
      ["source", "a", "b", "c", "d", "e", "product"],
      [
        { from: "source", to: "a" },
        { from: "a", to: "b" },
        { from: "b", to: "a" },
        { from: "b", to: "c" },
        { from: "c", to: "b" },
        { from: "c", to: "d" },
        { from: "d", to: "e" },
        { from: "e", to: "d" },
        { from: "e", to: "product" },
      ],
    );

    expect(graph.groups).toEqual([
      { nodeIds: ["source"], cyclic: false, rank: 0 },
      { nodeIds: ["a", "b", "c"], cyclic: true, rank: 1 },
      { nodeIds: ["d", "e"], cyclic: true, rank: 2 },
      { nodeIds: ["product"], cyclic: false, rank: 3 },
    ]);
    expect(graph.groupIndexByNodeId.get("c")).toBe(graph.groupIndexByNodeId.get("a"));
    expect(graph.groupIndexByNodeId.get("d")).not.toBe(graph.groupIndexByNodeId.get("a"));
  });

  it("共享上游、多路汇合和重复物流边不会虚增层级", () => {
    const graph = buildLayoutGraph(
      ["source", "short", "long-a", "long-b", "sink", "isolated"],
      [
        { from: "source", to: "short" },
        { from: "source", to: "long-a" },
        { from: "long-a", to: "long-b" },
        { from: "short", to: "sink" },
        { from: "short", to: "sink" },
        { from: "long-b", to: "sink" },
      ],
    );
    const rankOf = (id: string) => graph.groups[graph.groupIndexByNodeId.get(id)!]!.rank;

    expect(rankOf("source")).toBe(0);
    expect(rankOf("isolated")).toBe(0);
    expect(rankOf("short")).toBe(1);
    expect(rankOf("long-a")).toBe(1);
    expect(rankOf("long-b")).toBe(2);
    expect(rankOf("sink")).toBe(3);
    expect(graph.groups.every((group) => !group.cyclic)).toBe(true);
  });

  it("区分单设备自循环和孤立设备", () => {
    const graph = buildLayoutGraph(
      ["loop", "isolated"],
      [{ from: "loop", to: "loop" }],
    );

    expect(graph.groups[graph.groupIndexByNodeId.get("loop")!]).toEqual({
      nodeIds: ["loop"], cyclic: true, rank: 0,
    });
    expect(graph.groups[graph.groupIndexByNodeId.get("isolated")!]).toEqual({
      nodeIds: ["isolated"], cyclic: false, rank: 0,
    });
  });

  it("长链不依赖递归调用栈，且每个节点只属于一个分组", () => {
    const ids = Array.from({ length: 20_000 }, (_, index) => `node-${index}`);
    const edges = ids.slice(1).map((id, index) => ({ from: ids[index]!, to: id }));
    const graph = buildLayoutGraph(ids, edges);

    expect(graph.groups).toHaveLength(ids.length);
    expect(graph.groupIndexByNodeId.size).toBe(ids.length);
    expect(graph.groups[graph.groupIndexByNodeId.get(ids.at(-1)!)!]!.rank).toBe(19_999);
  });

  it("拒绝会丢失生产关系的重复节点和不存在的端点", () => {
    expect(() => buildLayoutGraph(["a", "a"], [])).toThrow("Duplicate layout node");
    expect(() => buildLayoutGraph(["a"], [{ from: "a", to: "missing" }]))
      .toThrow("Unknown layout edge endpoint");
    expect(buildLayoutGraph([], [])).toEqual({ groups: [], groupIndexByNodeId: new Map() });
  });
});
