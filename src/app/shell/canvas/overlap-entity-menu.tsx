import { useEffect, type CSSProperties, type PointerEvent } from "react";
import { observer } from "mobx-react-lite";

import type { AppHost } from "@/app/host/app-host";
import { OverlayStackLayer } from "@/app/shell/shared/overlay-stack";
import { cm } from "@/app/shell/shared/css-module-class";
import { createEntityIconAssetUrl } from "@/shared/browser/public-asset-url";
import styles from "@/app/shell/canvas/canvas.module.scss";

// AI-REMOVED 2026-08-20:
// Reason: 重叠实体菜单改为读取设备定义自身的 iconPath，不再维护局部资源映射。
// Trigger: 用户要求图标资源路径与设备 ID、spriteId 解耦。
// Evidence: EntityDefinition.iconPath 是必填字段，并由 Registry 契约测试校验资源存在。
// Replacement: 下方 createEntityIconAssetUrl(definition?.iconPath)。
// Risk: Low；缺失 definition 时统一显示缺失资源图标。
// Human Review: Required
//
// Original code:
// const DEVICE_ICON_SPECIAL_MAP: Record<string, string> = {
//   liquid_filling_pd_mc_1: "item_port_filling_pd_mc_1",
// };

export const OverlapEntityMenu = observer(function OverlapEntityMenu({
  appHost,
}: {
  readonly appHost: AppHost;
}) {
  const controller = appHost.overlapEntityMenu;
  const visible = controller.visible
    && controller.position !== null
    && controller.candidates.length > 1;
  const position = controller.position;
  const t = appHost.actions.translate;
  const definitionMap = new Map(
    appHost.workspace.registry.entityDefinitions.map((definition) => [definition.id, definition]),
  );

  useEffect(() => {
    if (!visible) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Escape") {
        return;
      }

      event.preventDefault();
      controller.cancel();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [controller, visible]);

  if (!visible || position === null) {
    return null;
  }

  const menuStyle = resolveMenuStyle(position);

  return (
    <OverlayStackLayer kind="system" layerId="overlap-entity-menu" visible={visible}>
      {({ zIndex }) => (
        <div className={cm(styles, "overlap-entity-menu-layer")} style={{ zIndex }}>
          <div
            aria-hidden="true"
            className={cm(styles, "overlap-entity-menu-backdrop")}
            onPointerDown={controller.cancel}
          />
          <div
            aria-label={t("tool.select")}
            className={cm(styles, "overlap-entity-menu")}
            onPointerDown={stopMenuPointerPropagation}
            role="menu"
            style={menuStyle}
          >
            {controller.candidates.map((candidate) => {
              const definition = definitionMap.get(candidate.definitionId);
              const label = definition === undefined
                ? candidate.definitionId
                : t(definition.nameKey);
              const iconSrc = createEntityIconAssetUrl(definition?.iconPath);

              return (
                <button
                  className={cm(styles, "overlap-entity-menu-item")}
                  key={candidate.entityId}
                  onClick={() => controller.select(candidate.entityId)}
                  role="menuitem"
                  type="button"
                >
                  <span className={cm(styles, "overlap-entity-menu-icon")} aria-hidden="true">
                    <img alt="" src={iconSrc} />
                  </span>
                  <span className={cm(styles, "overlap-entity-menu-label")}>{label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </OverlayStackLayer>
  );
});

function stopMenuPointerPropagation(event: PointerEvent<HTMLElement>): void {
  event.stopPropagation();
}

function resolveMenuStyle(position: { readonly x: number; readonly y: number }): CSSProperties {
  const viewportWidth = typeof window === "undefined" ? 0 : window.innerWidth;
  const viewportHeight = typeof window === "undefined" ? 0 : window.innerHeight;
  const alignRight = viewportWidth > 0 && position.x > viewportWidth - 216;
  const alignBottom = viewportHeight > 0 && position.y > viewportHeight - 180;

  return {
    left: position.x,
    top: position.y,
    transform: `translate(${alignRight ? "calc(-100% - 6px)" : "6px"}, ${alignBottom ? "calc(-100% - 6px)" : "6px"})`,
  };
}
