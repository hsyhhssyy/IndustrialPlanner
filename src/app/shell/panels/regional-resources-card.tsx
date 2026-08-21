import { useEffect, useMemo, useState } from "react";
import { observer } from "mobx-react-lite";

import type { AppHost } from "@/app/host/app-host";
import {
  normalizeRegionalPerMinute,
  resolveConfigurableRegionalResourceItems,
  type RegionalResourceSetting,
} from "@/app/regional-settings";
import {
  readVersionResourceLibrary,
  type VersionResourcePreset,
} from "@/app/shell/module-balancing";
import { NumberInput } from "@/app/shell/shared/number-input";
import { OverlayStackLayer } from "@/app/shell/shared/overlay-stack";
import { cm } from "@/app/shell/shared/css-module-class";
import { createItemIconAssetUrl } from "@/shared/browser/public-asset-url";
import LucideInfinity from "~icons/lucide/infinity";
import LucidePackageOpen from "~icons/lucide/package-open";
import LucidePlus from "~icons/lucide/plus";
import LucideTrash2 from "~icons/lucide/trash-2";
import LucideX from "~icons/lucide/x";

import styles from "./panels.module.scss";

export const RegionalResourcesCard = observer(function RegionalResourcesCard({
  appHost,
  regionTag,
}: {
  readonly appHost: AppHost;
  readonly regionTag: string;
}) {
  const t = appHost.actions.translate;
  const controller = appHost.regionalSettings;
  const resources = controller.getRegionResources(regionTag);
  const [profileDialogOpen, setProfileDialogOpen] = useState(false);
  const [versionProfiles, setVersionProfiles] = useState<readonly VersionResourcePreset[]>([]);
  const [profileLoadFailed, setProfileLoadFailed] = useState(false);
  const disabled = appHost.workspace.simulation?.state.runningState !== "stop";
  const configurableItems = useMemo(
    () => resolveConfigurableRegionalResourceItems(appHost.workspace.registry.itemDefinitions),
    [appHost.workspace.registry.itemDefinitions],
  );
  const itemById = useMemo(
    () => new Map(configurableItems.map((item) => [item.id, item])),
    [configurableItems],
  );
  const configuredItemIds = new Set(resources.map((resource) => resource.itemId));
  const selectableProfiles = versionProfiles.filter((profile) => profile.regionTag === regionTag);

  useEffect(() => {
    let cancelled = false;
    void readVersionResourceLibrary()
      .then((library) => {
        if (!cancelled) {
          setVersionProfiles(library.resources);
          setProfileLoadFailed(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setProfileLoadFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const addResource = async (): Promise<void> => {
    const itemId = await appHost.encyclopediaPicker.pickItem({
      title: t("regionalResources.addResource"),
      filterItem: (item) => (
        item.tags.includes("自然资源")
        && !item.tags.includes("无限供应")
        && !configuredItemIds.has(item.id)
      ),
    });
    if (itemId !== null) {
      controller.upsertResource(regionTag, itemId);
    }
  };

  const applyVersionProfile = (profile: VersionResourcePreset): void => {
    const configurableItemIds = new Set(configurableItems.map((item) => item.id));
    const nextResources: RegionalResourceSetting[] = profile.inputs.flatMap((input) => {
      if (!configurableItemIds.has(input.itemId)) {
        return [];
      }
      return [{
        itemId: input.itemId,
        mode: input.infinite === true ? "infinite" : "rate",
        perMinute: normalizeRegionalPerMinute(input.perMinute),
      }];
    });
    controller.setRegionResources(regionTag, nextResources);
    setProfileDialogOpen(false);
  };

  return (
    <>
      <article
        className={cm(styles, "inspector-card regional-resources-card")}
        data-device-class={appHost.state.screenProfile.deviceClass}
      >
        <div className={cm(styles, "card-header regional-resources-header")}>
          <h3>{t("regionalResources.title")}</h3>
          <span className={cm(styles, "regional-resources-region")}>{regionTag}</span>
        </div>
        <div className={cm(styles, "regional-resources-actions")}>
          <button
            disabled={disabled}
            onClick={() => setProfileDialogOpen(true)}
            type="button"
          >
            <LucidePackageOpen aria-hidden="true" />
            <span>{t("regionalResources.selectProfile")}</span>
          </button>
          <button
            disabled={disabled || configuredItemIds.size >= configurableItems.length}
            onClick={() => void addResource()}
            type="button"
          >
            <LucidePlus aria-hidden="true" />
            <span>{t("regionalResources.addResource")}</span>
          </button>
        </div>
        <div className={cm(styles, "regional-resources-list")}>
          {resources.map((resource) => {
            const item = itemById.get(resource.itemId);
            if (item === undefined) {
              return null;
            }
            const label = t(item.nameKey);
            return (
              <div className={cm(styles, "regional-resource-row")} key={resource.itemId}>
                <span className={cm(styles, "regional-resource-item")} title={label}>
                  <img
                    alt=""
                    aria-hidden="true"
                    draggable={false}
                    src={createItemIconAssetUrl(item.iconId)}
                  />
                  <span>{label}</span>
                </span>
                <span className={cm(styles, "regional-resource-rate")}>
                  {resource.mode === "infinite" ? (
                    <span className={cm(styles, "regional-resource-infinite-value")}>∞</span>
                  ) : (
                    <>
                      <NumberInput
                        aria-label={`${label} ${t("regionalResources.perMinute")}`}
                        className={cm(styles, "regional-resource-rate-input")}
                        disabled={disabled}
                        emptyFallback={10}
                        min={10}
                        onCommit={(value) => controller.upsertResource(regionTag, resource.itemId, {
                          mode: "rate",
                          perMinute: normalizeRegionalPerMinute(value),
                        })}
                        value={resource.perMinute}
                      />
                      <span>/min</span>
                    </>
                  )}
                </span>
                <button
                  aria-label={t("regionalResources.toggleInfinite")}
                  aria-pressed={resource.mode === "infinite"}
                  className={cm(
                    styles,
                    resource.mode === "infinite"
                      ? "regional-resource-infinity is-active"
                      : "regional-resource-infinity",
                  )}
                  disabled={disabled}
                  onClick={() => controller.setResourceMode(
                    regionTag,
                    resource.itemId,
                    resource.mode === "infinite" ? "rate" : "infinite",
                  )}
                  type="button"
                >
                  <LucideInfinity aria-hidden="true" />
                </button>
                <button
                  aria-label={t("regionalResources.removeResource")}
                  className={cm(styles, "regional-resource-remove")}
                  disabled={disabled}
                  onClick={() => controller.removeResource(regionTag, resource.itemId)}
                  type="button"
                >
                  <LucideTrash2 aria-hidden="true" />
                </button>
              </div>
            );
          })}
        </div>
      </article>
      <RegionalResourceProfileDialog
        loadFailed={profileLoadFailed}
        onApplyInfinite={() => {
          controller.applyInfiniteProfile(regionTag);
          setProfileDialogOpen(false);
        }}
        onCancel={() => setProfileDialogOpen(false)}
        onSelect={applyVersionProfile}
        open={profileDialogOpen}
        profiles={selectableProfiles}
        resolveItemName={(itemId) => {
          const item = itemById.get(itemId);
          return item === undefined ? itemId : t(item.nameKey);
        }}
        t={t}
      />
    </>
  );
});

function RegionalResourceProfileDialog({
  loadFailed,
  onApplyInfinite,
  onCancel,
  onSelect,
  open,
  profiles,
  resolveItemName,
  t,
}: {
  readonly loadFailed: boolean;
  readonly onApplyInfinite: () => void;
  readonly onCancel: () => void;
  readonly onSelect: (profile: VersionResourcePreset) => void;
  readonly open: boolean;
  readonly profiles: readonly VersionResourcePreset[];
  readonly resolveItemName: (itemId: string) => string;
  readonly t: AppHost["actions"]["translate"];
}) {
  return (
    <OverlayStackLayer layerId="regional-resource-profiles" visible={open}>
      {({ zIndex }) => (
        <div
          className={cm(styles, "regional-resource-profile-backdrop")}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              onCancel();
            }
          }}
          style={{ zIndex }}
        >
          <section
            aria-modal="true"
            className={cm(styles, "regional-resource-profile-dialog")}
            role="dialog"
          >
            <header>
              <h2>{t("regionalResources.selectProfile")}</h2>
              <button aria-label={t("action.close")} onClick={onCancel} type="button">
                <LucideX aria-hidden="true" />
              </button>
            </header>
            <div className={cm(styles, "regional-resource-profile-list")}>
              <button onClick={onApplyInfinite} type="button">
                <LucideInfinity aria-hidden="true" />
                <span>
                  <strong>{t("regionalResources.infiniteProfile")}</strong>
                  <small>{t("regionalResources.infiniteProfileSummary")}</small>
                </span>
              </button>
              {profiles.map((profile) => (
                <button key={profile.id} onClick={() => onSelect(profile)} type="button">
                  <LucidePackageOpen aria-hidden="true" />
                  <span>
                    <strong>{profile.name}</strong>
                    <small>{profile.inputs
                      .filter((input) => input.infinite !== true)
                      .map((input) => `${resolveItemName(input.itemId)} ${input.perMinute}/min`)
                      .join(" · ")}</small>
                  </span>
                </button>
              ))}
            </div>
            {loadFailed ? (
              <p className={cm(styles, "regional-resource-profile-error")}>
                {t("regionalResources.profileLoadFailed")}
              </p>
            ) : null}
          </section>
        </div>
      )}
    </OverlayStackLayer>
  );
}
