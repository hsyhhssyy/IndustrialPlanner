import { describe, expect, it } from "vitest";
import { resolveHostingSite } from "@/shared/browser/hosting-site";

describe("resolveHostingSite", () => {
  it.each([
    ["https://endfield.anonymous-test.top/", "cloudflare"],
    ["https://endfield.amiyabot.com/", "amiyabot"],
    ["https://www.taptap.cn/tools/27629", "taptap"],
    ["https://taptap.cn/", "taptap"],
    ["https://www.taptap.com/", "taptap"],
    ["https://www.taptap.io/", "taptap"],
    ["https://ENDFIELD.AMIYABOT.COM.:8443/", "amiyabot"],
  ])("recognizes the current hostname in %s", (url, expected) => {
    expect(resolveHostingSite(new URL(url).hostname)).toBe(expected);
  });

  it.each([
    "localhost", "127.0.0.1", "[::1]", "192.168.1.100",
    "endfield-alpha.hsyhhssyy.net", "preview.pages.dev", "",
    "endfield-alpha.amiyabot.com", "endfield-alpha.anonymous-test.top",
    "endfield.amiyabot.com.example.org", "endfield.anonymous-test.top.example.org",
    "taptap.cn.example.org", "not-taptap.cn",
  ])("uses the test marker for unregistered hostname %s", hostname => {
    expect(resolveHostingSite(hostname)).toBe("test");
  });

  it("normalizes hostname case and the DNS root dot", () => {
    expect(resolveHostingSite("ENDFIELD.ANONYMOUS-TEST.TOP.")).toBe("cloudflare");
    expect(resolveHostingSite("WWW.TAPTAP.CN.")).toBe("taptap");
  });
});
