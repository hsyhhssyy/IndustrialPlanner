import { describe, expect, it, vi } from "vitest";
import { RenderResourceScope } from "@/renderer/texture";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

describe("view resource lifetime", () => {
  it("waits for resources discovered by a completion callback and invalidates after consumers run", async () => {
    const events: string[] = [];
    const scope = new RenderResourceScope(() => events.push("invalidate"));
    const first = deferred<void>(), second = deferred<void>();
    scope.track(first.promise).then(() => { events.push("consumer"); scope.track(second.promise); });
    let idle = false;
    const waiting = scope.waitForIdle().then(() => { idle = true; });
    first.resolve();
    await first.promise;
    await Promise.resolve();
    expect(events).toEqual(["consumer", "invalidate"]);
    expect(scope.loading).toBe(true);
    expect(idle).toBe(false);
    second.resolve();
    await waiting;
    expect(idle).toBe(true);
    expect(scope.loading).toBe(false);
    scope.dispose();
  });

  it.each([new Error("decode failed"), undefined])("propagates a resource rejection including an undefined reason (%s)", async (error) => {
    const scope = new RenderResourceScope(() => {});
    scope.track(Promise.reject(error));
    await expect(scope.waitForIdle()).rejects.toBe(error);
    scope.dispose();
  });

  it("cancels pending initialization and ignores late success or failure after disposal", async () => {
    const invalidate = vi.fn();
    const scope = new RenderResourceScope(invalidate);
    const first = deferred<void>(), second = deferred<void>();
    scope.track(first.promise); scope.track(second.promise);
    const waiting = scope.waitForIdle();
    scope.dispose(); scope.dispose();
    await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
    first.resolve(); second.reject(new Error("late failure"));
    await Promise.allSettled([first.promise, second.promise]);
    await Promise.resolve();
    expect(invalidate).not.toHaveBeenCalled();
    expect(scope.loading).toBe(false);
  });
});
