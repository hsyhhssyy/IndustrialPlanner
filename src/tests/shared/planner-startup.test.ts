import { describe, expect, it } from "vitest";
import { plannerStartupClosure } from "@/shared/planner-startup";

describe("启动依赖闭包", () => {
  it("全部前置条件满足后才传播，替代来源采用 OR，结果不依赖配方顺序", () => {
    const operations = [
      { id: "first", requirements: [["raw"], ["environment:a", "environment:b"]], outputs: ["seed"] },
      { id: "loop", requirements: [["seed"], ["raw"]], outputs: ["seed", "next"] },
      { id: "tail", requirements: [["next"]], outputs: ["product"] },
    ];
    for (const order of [operations, [...operations].reverse()]) {
      expect(plannerStartupClosure(order, ["raw"]).started.size).toBe(0);
      expect([...plannerStartupClosure(order, ["raw", "environment:b"]).started].sort()).toEqual(["first", "loop", "tail"]);
    }
  });
  it("生产者存在不代表先能启动，闭合依赖不能凭空产生第一份料", () => {
    const result = plannerStartupClosure([
      { id: "source", requirements: [["downstream"]], outputs: ["seed"] },
      { id: "converter", requirements: [["seed"]], outputs: ["downstream"] },
    ], []);
    expect(result.started.size).toBe(0);
    expect(result.available.size).toBe(0);
  });
});
