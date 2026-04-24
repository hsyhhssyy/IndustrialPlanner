import { useEffect, useRef } from "react";
import { observer } from "mobx-react-lite";

import type { AppHost } from "@/app/app-host";
import {
  type SettingsGroupId,
  type WorkbenchSettingDefinition,
  WORKBENCH_SETTINGS_GROUPS,
  WorkbenchSettingsDialogController,
} from "@/app/app-shell/settings-dialog-state";
import { WorkbenchIcon } from "@/app/app-shell/components/workbench-icons";
import { isMobilePortraitScreenProfile } from "@/shared/browser/screen-profile";

interface SettingsDialogProps {
  appHost: AppHost;
  controller: WorkbenchSettingsDialogController;
}

export const SettingsDialog = observer(function SettingsDialog({
  appHost,
  controller,
}: SettingsDialogProps) {
  const t = appHost.actions.translate;
  const contentRef = useRef<HTMLDivElement | null>(null);
  const sectionRefs = useRef(new Map<SettingsGroupId, HTMLElement>());
  const isMobilePortrait = isMobilePortraitScreenProfile(appHost.state.screenProfile);

  useEffect(() => {
    if (!controller.isOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      event.preventDefault();
      controller.close();
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [controller, controller.isOpen]);

  useEffect(() => {
    if (!controller.isOpen || isMobilePortrait) {
      return;
    }

    const selectedSection = sectionRefs.current.get(controller.selectedGroupId);
    if (typeof selectedSection?.scrollIntoView !== "function") {
      return;
    }

    selectedSection.scrollIntoView({ block: "start" });
  }, [controller.isOpen, controller.selectedGroupId, isMobilePortrait]);

  if (!controller.isOpen) {
    return null;
  }

  const selectedGroup = controller.selectedGroup;

  return (
    <div
      className="settings-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target !== event.currentTarget) {
          return;
        }

        controller.close();
      }}
    >
      <section
        aria-labelledby="settings-dialog-title"
        aria-modal="true"
        className="settings-dialog"
        role="dialog"
      >
        <header className="settings-dialog-header">
          <div className="settings-dialog-header-copy">
            <h2 id="settings-dialog-title">{t("settingsDialog.title")}</h2>
          </div>
          <button
            aria-label={t("action.close")}
            className="settings-dialog-close"
            onClick={controller.close}
            title={t("action.close")}
            type="button"
          >
            <span className="top-bar-toggle-icon">
              <WorkbenchIcon kind="cancel" />
            </span>
            <span className="sr-only">{t("action.close")}</span>
          </button>
        </header>
        <div
          className={isMobilePortrait
            ? "settings-dialog-layout settings-dialog-layout-single-pane"
            : "settings-dialog-layout"}
        >
          {isMobilePortrait ? null : (
            <aside className="settings-dialog-sidebar">
            <div className="settings-dialog-sidebar-title">{t("settingsDialog.groups")}</div>
            <div aria-label={t("settingsDialog.groups")} className="settings-dialog-tree" role="tree">
              {WORKBENCH_SETTINGS_GROUPS.map((group) => {
                const isActive = group.id === selectedGroup.id;

                return (
                  <button
                    aria-selected={isActive}
                    aria-controls={`settings-dialog-group-${group.id}`}
                    className={isActive
                      ? "settings-dialog-tree-button is-active"
                      : "settings-dialog-tree-button"}
                    key={group.id}
                    onClick={() => {
                      controller.selectGroup(group.id);
                    }}
                    role="treeitem"
                    type="button"
                  >
                    <span className="settings-dialog-tree-label">{t(group.labelKey)}</span>
                  </button>
                );
              })}
            </div>
            </aside>
          )}
          <div className="settings-dialog-content" ref={contentRef}>
            {WORKBENCH_SETTINGS_GROUPS.map((group) => (
              <section
                className="settings-dialog-group-section"
                id={`settings-dialog-group-${group.id}`}
                key={group.id}
                ref={(element) => {
                  if (element === null) {
                    sectionRefs.current.delete(group.id);

                    return;
                  }

                  sectionRefs.current.set(group.id, element);
                }}
              >
                <div className="settings-dialog-group-header">
                  <h3>{t(group.labelKey)}</h3>
                  <p>{t(group.descriptionKey)}</p>
                </div>
                <div className="settings-dialog-settings-list">
                  {group.items.map((setting) => (
                    <article className="settings-dialog-setting-card" key={setting.id}>
                      <div className="settings-dialog-setting-copy">
                        <h4>{t(setting.labelKey)}</h4>
                        <p>{t(setting.descriptionKey)}</p>
                      </div>
                      <div className="settings-dialog-setting-control">
                        {renderSettingControl({ controller, setting, t })}
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
});

function renderSettingControl(options: {
  controller: WorkbenchSettingsDialogController;
  setting: WorkbenchSettingDefinition;
  t: AppHost["actions"]["translate"];
}) {
  const { controller, setting, t } = options;
  const value = controller.values[setting.id];

  if (setting.kind === "select") {
    return (
      <label className="settings-dialog-field-shell" htmlFor={`setting-${setting.id}`}>
        <select
          id={`setting-${setting.id}`}
          name={setting.id}
          onChange={(event) => {
            controller.updateSelectValue(setting.id, event.target.value);
          }}
          value={typeof value === "string" ? value : setting.defaultValue}
        >
          {setting.options.map((option) => (
            <option key={option.value} value={option.value}>
              {t(option.labelKey)}
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (setting.kind === "slider") {
    const numericValue = typeof value === "number" ? value : setting.defaultValue;

    return (
      <label className="settings-dialog-slider-shell" htmlFor={`setting-${setting.id}`}>
        <input
          id={`setting-${setting.id}`}
          max={setting.max}
          min={setting.min}
          name={setting.id}
          onChange={(event) => {
            controller.updateSliderValue(setting.id, Number(event.target.value));
          }}
          step={setting.step}
          type="range"
          value={numericValue}
        />
        <span className="settings-dialog-slider-value">{numericValue}%</span>
      </label>
    );
  }

  const checked = typeof value === "boolean" ? value : setting.defaultValue;

  return (
    <label className="settings-dialog-switch-shell" htmlFor={`setting-${setting.id}`}>
      <input
        checked={checked}
        id={`setting-${setting.id}`}
        name={setting.id}
        onChange={(event) => {
          controller.updateSwitchValue(setting.id, event.target.checked);
        }}
        type="checkbox"
      />
      <span className="settings-dialog-switch-track" aria-hidden="true">
        <span className="settings-dialog-switch-thumb" />
      </span>
      <span className="settings-dialog-switch-label">
        {t(checked ? "settingsOption.enabled" : "settingsOption.disabled")}
      </span>
    </label>
  );
}