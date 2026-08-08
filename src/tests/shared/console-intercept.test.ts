// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  formatConsoleArguments,
  installConsoleIntercept,
} from "@/shared/logging/install-console-intercept";
import type { LogEntryInput } from "@/shared/logging/log-collector-protocol";
import { installGlobalErrorCapture } from "@/shared/logging/install-global-error-capture";

const disposers: Array<() => void> = [];

afterEach(() => {
  while (disposers.length > 0) {
    disposers.pop()?.();
  }
  vi.restoreAllMocks();
});

describe("installConsoleIntercept", () => {
  it("preserves original console output and avoids formatting while disabled", () => {
    const originalWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const entries: LogEntryInput[] = [];
    let enabled = false;
    disposers.push(installConsoleIntercept({
      source: "main",
      instanceId: "main-test",
      readEnabled: () => enabled,
      send: (entry) => entries.push(entry),
    }));

    const expensiveValue = { get value(): never {
      throw new Error("serializer should not run");
    } };
    console.warn(expensiveValue);
    expect(originalWarn.mock.calls[0]?.[0]).toBe(expensiveValue);
    expect(entries).toEqual([]);

    enabled = true;
    console.warn("captured", 42n);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      level: "warn",
      source: "main",
      instanceId: "main-test",
      message: "captured 42",
    });
  });

  it("is reference-counted and safely serializes cycles, errors and functions", () => {
    const originalLog = vi.spyOn(console, "log").mockImplementation(() => {});
    const entries: LogEntryInput[] = [];
    const options = {
      source: "main" as const,
      instanceId: "main-test",
      readEnabled: () => true,
      send: (entry: LogEntryInput) => entries.push(entry),
    };
    const firstDispose = installConsoleIntercept(options);
    const secondDispose = installConsoleIntercept(options);
    disposers.push(firstDispose, secondDispose);

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    console.log(cyclic, new Error("boom"), function namedFunction() {});
    expect(entries).toHaveLength(1);
    expect(entries[0]?.message).toContain("[Circular]");
    expect(entries[0]?.message).toContain("boom");
    expect(entries[0]?.message).toContain("[Function namedFunction]");

    firstDispose();
    console.log("still installed");
    expect(entries).toHaveLength(2);
    secondDispose();
    console.log("restored");
    expect(entries).toHaveLength(2);
    expect(originalLog).toHaveBeenCalledTimes(3);
  });
});

describe("formatConsoleArguments", () => {
  it("handles symbols and undefined without throwing", () => {
    expect(formatConsoleArguments([Symbol("test"), undefined])).toBe(
      "Symbol(test) undefined",
    );
  });
});

describe("installGlobalErrorCapture", () => {
  it("injects error and unhandledrejection into the same console chain", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const entries: LogEntryInput[] = [];
    disposers.push(installConsoleIntercept({
      source: "main",
      instanceId: "main-test",
      readEnabled: () => true,
      send: (entry) => entries.push(entry),
    }));
    disposers.push(installGlobalErrorCapture(window));

    const errorEvent = new Event("error");
    Object.defineProperties(errorEvent, {
      message: { value: "global boom" },
      filename: { value: "console-intercept.test.ts" },
      lineno: { value: 12 },
      colno: { value: 3 },
      error: { value: new Error("global boom") },
    });
    window.dispatchEvent(errorEvent);

    const rejectionEvent = new Event("unhandledrejection");
    Object.defineProperty(rejectionEvent, "reason", {
      value: new Error("promise boom"),
    });
    window.dispatchEvent(rejectionEvent);

    expect(entries).toHaveLength(2);
    expect(entries[0]?.message).toContain("[global.error]");
    expect(entries[0]?.message).toContain("console-intercept.test.ts:12:3");
    expect(entries[1]?.message).toContain("[global.unhandledrejection]");
    expect(entries[1]?.message).toContain("promise boom");
  });
});
