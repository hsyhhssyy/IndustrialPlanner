import { useEffect, useRef, useState } from "react";
import { observer } from "mobx-react-lite";

import type { AppHost } from "@/app/host/app-host";
import {
  type SettingsGroupId,
  type WorkbenchSettingDefinition,
  WORKBENCH_SETTINGS_GROUPS,
  WorkbenchSettingsDialogController,
} from "@/app/shell/settings-dialog-state";
import { WorkbenchIcon } from "@/app/shell/components/workbench-icons";
import { isMobilePortraitScreenProfile } from "@/shared/browser/screen-profile";

const SETTINGS_DIALOG_SECTION_SCROLL_OFFSET = 10;

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
  const [capturingKeybindingId, setCapturingKeybindingId] = useState<string | null>(null);
  const isMobilePortrait = isMobilePortraitScreenProfile(appHost.state.screenProfile);

  useEffect(() => {
    if (controller.isOpen) {
      return;
    }

    setCapturingKeybindingId(null);
  }, [controller.isOpen]);

  useEffect(() => {
    if (!controller.isOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (capturingKeybindingId !== null) {
        event.preventDefault();
        event.stopPropagation();

        if (event.key === "Escape") {
          setCapturingKeybindingId(null);

          return;
        }

        if (!controller.isSettingEditable(capturingKeybindingId)) {
          setCapturingKeybindingId(null);

          return;
        }

        const nextValue = formatCapturedKeybinding(event);
        if (nextValue === null) {
          return;
        }

        controller.updateKeybindingValue(capturingKeybindingId, nextValue);
        setCapturingKeybindingId(null);

        return;
      }

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
  }, [capturingKeybindingId, controller, controller.isOpen]);

  useEffect(() => {
    if (!controller.isOpen || isMobilePortrait) {
      return;
    }

    const contentElement = contentRef.current;
    const selectedSection = sectionRefs.current.get(controller.selectedGroupId);
    if (contentElement === null || selectedSection === undefined) {
      return;
    }

    scrollSettingsDialogContentToSection({
      contentElement,
      selectedSection,
    });
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
                  {group.items.map((setting) => {
                    const isEditable = controller.isSettingEditable(setting.id);

                    const isKeybinding = setting.kind === "keybinding";

                    return (
                      <article
                        aria-disabled={!isEditable}
                        className={
                          [
                            "settings-dialog-setting-card",
                            isEditable ? "" : "is-disabled",
                            isKeybinding ? "is-keybinding" : "",
                          ].filter(Boolean).join(" ")
                        }
                        key={setting.id}
                      >
                        <div className="settings-dialog-setting-copy">
                          <h4>{t(setting.labelKey)}</h4>
                          {!isKeybinding && <p>{t(setting.descriptionKey)}</p>}
                        </div>
                        <div className="settings-dialog-setting-control">
                          {renderSettingControl({
                            controller,
                            setting,
                            t,
                            isEditable,
                            capturingKeybindingId,
                            onStartCapturing: setCapturingKeybindingId,
                          })}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
});

function scrollSettingsDialogContentToSection(options: {
  contentElement: HTMLDivElement;
  selectedSection: HTMLElement;
}): void {
  const { contentElement, selectedSection } = options;
  const contentRect = contentElement.getBoundingClientRect();
  const sectionRect = selectedSection.getBoundingClientRect();
  const nextScrollTop = Math.max(
    0,
    contentElement.scrollTop + sectionRect.top - contentRect.top - SETTINGS_DIALOG_SECTION_SCROLL_OFFSET,
  );

  if (typeof contentElement.scrollTo === "function") {
    contentElement.scrollTo({ top: nextScrollTop });
    return;
  }

  contentElement.scrollTop = nextScrollTop;
}

function renderSettingControl(options: {
  controller: WorkbenchSettingsDialogController;
  setting: WorkbenchSettingDefinition;
  t: AppHost["actions"]["translate"];
  isEditable: boolean;
  capturingKeybindingId: string | null;
  onStartCapturing: (settingId: string | null) => void;
}) {
  const {
    controller,
    setting,
    t,
    isEditable,
    capturingKeybindingId,
    onStartCapturing,
  } = options;
  const value = controller.getValue(setting.id);

  if (setting.kind === "select") {
    return (
      <label className="settings-dialog-field-shell" htmlFor={`setting-${setting.id}`}>
        <select
          disabled={!isEditable}
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
          disabled={!isEditable}
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

  if (setting.kind === "keybinding") {
    const isCapturing = capturingKeybindingId === setting.id;
    const buttonLabel = isCapturing
      ? t("settingsKeybinding.awaitingInput")
      : (typeof value === "string" ? value : setting.defaultValue);

    return (
      <button
        aria-pressed={isCapturing}
        className={isCapturing
          ? "settings-dialog-keybinding-button is-capturing"
          : "settings-dialog-keybinding-button"}
        data-setting-id={setting.id}
        disabled={!isEditable}
        id={`setting-${setting.id}`}
        onClick={(event) => {
          event.preventDefault();
        }}
        onMouseDown={(event) => {
          event.preventDefault();

          if (!isEditable) {
            return;
          }

          onStartCapturing(setting.id);
        }}
        title={buttonLabel}
        type="button"
      >
        {buttonLabel}
      </button>
    );
  }

  const checked = typeof value === "boolean" ? value : setting.defaultValue;

  return (
    <label
      className={isEditable
        ? "settings-dialog-switch-shell"
        : "settings-dialog-switch-shell is-disabled"}
      htmlFor={`setting-${setting.id}`}
    >
      <input
        checked={checked}
        disabled={!isEditable}
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

function formatCapturedKeybinding(event: KeyboardEvent): string | null {
  if (isModifierOnlyKey(event.key)) {
    return null;
  }

  const keyLabel = normalizeCapturedKeyLabel(event.key);
  if (keyLabel === null) {
    return null;
  }

  const parts: string[] = [];

  if (event.ctrlKey) {
    parts.push("Ctrl");
  }

  if (event.altKey) {
    parts.push("Alt");
  }

  if (event.shiftKey) {
    parts.push("Shift");
  }

  if (event.metaKey) {
    parts.push("Meta");
  }

  if (!parts.includes(keyLabel)) {
    parts.push(keyLabel);
  }

  return parts.join("+");
}

function normalizeCapturedKeyLabel(key: string): string | null {
  if (key === "") {
    return null;
  }

  if (key === " ") {
    return "Space";
  }

  if (key === "Escape") {
    return "Esc";
  }

  if (key === "ArrowUp") {
    return "Up";
  }

  if (key === "ArrowDown") {
    return "Down";
  }

  if (key === "ArrowLeft") {
    return "Left";
  }

  if (key === "ArrowRight") {
    return "Right";
  }

  if (key.length === 1) {
    return key.toUpperCase();
  }

  return key;
}

function isModifierOnlyKey(key: string): boolean {
  return key === "Shift" || key === "Control" || key === "Alt" || key === "Meta";
}