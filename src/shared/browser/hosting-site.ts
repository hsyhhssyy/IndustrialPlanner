export type HostingSite = "cloudflare" | "amiyabot" | "taptap" | "test";

/** 只按当前页面的主机名识别部署，不使用 referrer 或外层页面推断托管方。 */
export function resolveHostingSite(hostname: string): HostingSite {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");

  if (normalized === "endfield.anonymous-test.top") {
    return "cloudflare";
  }
  if (normalized === "endfield.amiyabot.com") {
    return "amiyabot";
  }
  if (["taptap.cn", "taptap.com", "taptap.io"].some(
    domain => normalized === domain || normalized.endsWith(`.${domain}`),
  )) {
    return "taptap";
  }

  // 本地、内网、Alpha 和未登记的部署统一使用测试环境标识。
  return "test";
}
