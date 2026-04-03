import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createLogger,
  getLogLevel,
  setLogLevel,
} from "@/shared/logging/logger";

describe("shared logger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    setLogLevel("warn");
  });

  it("filters console output by the active log level", () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const logger = createLogger("tests.logger");

    setLogLevel("warn");
    logger.info("info should be filtered");
    logger.warn("warn should be visible");

    expect(infoSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      "[industrial-planner:tests.logger] warn should be visible",
    );
  });

  it("announces explicit log level changes and updates the active level", () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);

    setLogLevel("debug", { announce: true });

    expect(getLogLevel()).toBe("debug");
    expect(infoSpy).toHaveBeenCalledWith(
      '[industrial-planner] Log level changed from "warn" to "debug".',
    );
  });
});
