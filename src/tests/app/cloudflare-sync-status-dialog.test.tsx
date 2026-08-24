// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { makeAutoObservable } from "mobx";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CloudflareSyncStatusDialog } from "@/app/shell/dialogs/cloudflare-sync-status-dialog";
import { OverlayStackProvider } from "@/app/shell/shared/overlay-stack";
import type { DialogStateReadWrite } from "@/app/state/state-impl";
import { readCloudflareSyncSettings } from "@/shared/storage/cloudflare-sync-settings";
import {
  readCloudflareOAuthSession,
  writeCloudflareOAuthSession,
} from "@/shared/storage/cloudflare-oauth-session";
import { writeBackendApiAddressOverride } from "@/shared/storage/backend-api-address";
import {
  readSyncProviderActivation,
} from "@/shared/storage/sync-provider-activation";
import { SyncStateImpl } from "@/sync/sync-state-impl";
import { createFakeIndexedDbFactory } from "../shared/fake-indexed-db";

describe("CloudflareSyncStatusDialog", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
  });

  it("keeps the Space ID as a draft until explicit enable is pressed", async () => {
    class ClosedBroadcastChannel {
      public addEventListener(): void {}
      public close(): void {}
      public postMessage(): void {}
    }
    const openPopup = vi.fn((
      _url?: string | URL,
      _target?: string,
      _features?: string,
    ) => null);
    vi.stubGlobal("BroadcastChannel", ClosedBroadcastChannel);
    vi.stubGlobal("crypto", {
      randomUUID: () => "01234567-89ab-4cde-8fab-0123456789ab",
    });
    vi.stubGlobal("open", openPopup);
    const state = new SyncStateImpl();
    state.setSettings({
      enabled: true,
      url: "",
      username: "",
      password: "",
      maxConcurrentRequests: 4,
    });
    const dialogState = makeAutoObservable<DialogStateReadWrite>({
      visible: true,
      maximized: false,
      offsetX: 0,
      offsetY: 0,
      width: 760,
      height: 620,
      activeTab: null,
    });

    await act(async () => {
      root.render(
        <OverlayStackProvider>
          <CloudflareSyncStatusDialog
            aborting={false}
            compactMobileLayout={false}
            deleting={false}
            dialogState={dialogState}
            onAbortCurrentTransaction={vi.fn()}
            onClose={vi.fn()}
            onDeleteAllData={vi.fn()}
            onOffsetChange={vi.fn()}
            onResize={vi.fn()}
            onToggleMaximized={vi.fn()}
            state={state}
            t={(key) => key}
          />
        </OverlayStackProvider>,
      );
      await Promise.resolve();
    });

    const input = document.querySelector<HTMLInputElement>(
      "[data-cloudflare-space-name-input]",
    );
    const saveButton = document.querySelector<HTMLButtonElement>(
      "[data-cloudflare-space-name-save]",
    );
    expect(input?.value).toBe("");
    expect(saveButton?.disabled).toBe(true);

    await act(async () => {
      document.querySelector<HTMLButtonElement>("[data-cloudflare-oauth-login]")?.click();
      await Promise.resolve();
    });
    const authorizeUrl = new URL(String(openPopup.mock.calls[0]?.[0]));
    expect(`${authorizeUrl.origin}${authorizeUrl.pathname}`).toBe(
      "https://endfield-api.amiyabot.com/v1/oauth/authorize",
    );
    expect(authorizeUrl.searchParams.get("frontend_redirect_uri")).toBe(
      "http://localhost:3000/auth/callback",
    );
    expect(authorizeUrl.searchParams.get("oauth_channel")).toBe(
      "01234567-89ab-4cde-8fab-0123456789ab",
    );
    expect(openPopup).toHaveBeenCalledWith(
      authorizeUrl.href,
      "industrial-planner-cloudflare-oauth",
      "popup,width=520,height=720",
    );

    act(() => {
      if (input === null) throw new Error("Missing Cloudflare space input.");
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(input, "factory-a");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await expect(readCloudflareSyncSettings()).resolves.toEqual({
      spaceName: "",
      remoteMode: "anonymous",
    });
    expect(saveButton?.disabled).toBe(false);

    await act(async () => {
      saveButton?.click();
      await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
    });
    await expect(readCloudflareSyncSettings()).resolves.toEqual({
      spaceName: "factory-a",
      remoteMode: "anonymous",
    });
    expect(readSyncProviderActivation()).toMatchObject({
      state: "active",
      provider: "cloudflare",
    });
    expect(saveButton?.disabled).toBe(true);
  });

  it("requires explicit account activation and keeps account mode after logout", async () => {
    writeBackendApiAddressOverride("https://backend.test");
    writeCloudflareOAuthSession({
      schemaVersion: 1,
      apiBaseUrl: "https://backend.test",
      accessToken: "session-token",
      tokenType: "Bearer",
      expiresAt: "2099-01-01T00:00:00.000Z",
      account: {
        accountId: "account-1",
        username: "planner-user",
      },
      spaceId: "account-space-1",
    });
    const state = new SyncStateImpl();
    state.setSettings({
      enabled: true,
      url: "",
      username: "",
      password: "",
      maxConcurrentRequests: 4,
    });
    const dialogState = makeAutoObservable<DialogStateReadWrite>({
      visible: true,
      maximized: false,
      offsetX: 0,
      offsetY: 0,
      width: 760,
      height: 620,
      activeTab: null,
    });

    await act(async () => {
      root.render(
        <OverlayStackProvider>
          <CloudflareSyncStatusDialog
            aborting={false}
            compactMobileLayout={false}
            deleting={false}
            dialogState={dialogState}
            onAbortCurrentTransaction={vi.fn()}
            onClose={vi.fn()}
            onDeleteAllData={vi.fn()}
            onOffsetChange={vi.fn()}
            onResize={vi.fn()}
            onToggleMaximized={vi.fn()}
            state={state}
            t={(key) => key}
          />
        </OverlayStackProvider>,
      );
      await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
    });

    expect(document.querySelector("[data-cloudflare-oauth-username]")?.textContent)
      .toBe("planner-user");
    expect(document.querySelector("[data-cloudflare-space-name-input]")).not.toBeNull();
    await expect(readCloudflareSyncSettings()).resolves.toEqual({
      spaceName: "",
      remoteMode: "anonymous",
    });

    await act(async () => {
      document.querySelector<HTMLButtonElement>("[data-cloudflare-account-activate]")?.click();
      await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
    });
    await expect(readCloudflareSyncSettings()).resolves.toMatchObject({
      remoteMode: "account",
    });
    expect(readSyncProviderActivation()).toMatchObject({
      state: "active",
      provider: "cloudflare",
    });

    act(() => {
      document.querySelector<HTMLButtonElement>("[data-cloudflare-oauth-logout]")?.click();
    });

    expect(readCloudflareOAuthSession("https://backend.test")).toBeNull();
    expect(document.querySelector("[data-cloudflare-oauth-login]")).not.toBeNull();
    expect(document.querySelector("[data-cloudflare-oauth-description]")?.textContent)
      .toBe("cloudflareStatus.loginRequiredDescription");
    expect(document.querySelector("[data-cloudflare-space-name-input]")).not.toBeNull();
    await expect(readCloudflareSyncSettings()).resolves.toMatchObject({
      remoteMode: "account",
    });
  });
});
