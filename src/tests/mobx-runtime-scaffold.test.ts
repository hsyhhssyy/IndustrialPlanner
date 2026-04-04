import { describe, expect, it } from "vitest";
import { autorun, makeAutoObservable } from "@/shared/mobx";

class Counter {
  value = 0;

  constructor() {
    makeAutoObservable(this);
  }

  increment() {
    this.value += 1;
  }
}

describe("shared mobx scaffold", () => {
  it("re-exports observable helpers through a local module boundary", () => {
    const counter = new Counter();
    const values: number[] = [];
    const stop = autorun(() => {
      values.push(counter.value);
    });

    counter.increment();
    stop();

    expect(values).toEqual([0, 1]);
  });
});
