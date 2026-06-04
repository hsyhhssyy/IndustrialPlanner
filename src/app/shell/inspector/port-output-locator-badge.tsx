import { useMemo } from "react";

import type { GridRotation } from "@/domain/shared/grid";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import { getRotatedGridFootprint } from "@/shared/geometry/grid";
import { resolveRotatedPortGeometry } from "@/shared/geometry/port";
import type { OutputGroupRow } from "@/app/shell/inspector/port-output-config-model";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";

interface LocatorMarker {
  readonly groupId: string;
  readonly portId: string;
  readonly x: number;
  readonly y: number;
}

interface LocatorModel {
  readonly footprint: {
    readonly width: number;
    readonly height: number;
  };
  readonly viewBox: string;
  readonly markers: readonly LocatorMarker[];
  readonly selectedMarkers: readonly LocatorMarker[];
  readonly selectedPolylinePoints: string | null;
}

export function PortOutputLocatorBadge({
  definition,
  portLabel,
  rows,
  rotation,
  targetPortGroupId,
  title,
}: {
  readonly definition: EntityDefinition;
  readonly portLabel: string;
  readonly rows: readonly OutputGroupRow[];
  readonly rotation: GridRotation;
  readonly targetPortGroupId: string;
  readonly title: string;
}) {
  const model = useMemo(
    () => resolveLocatorModel({
      definition,
      rows,
      rotation,
      targetPortGroupId,
    }),
    [definition, rows, rotation, targetPortGroupId],
  );

  return (
    <span
      aria-label={title}
      className={cm(styles, "port-output-locator")}
      data-locator-rotation={rotation}
      data-port-output-locator={targetPortGroupId}
      role="img"
      title={title}
    >
      <svg
        aria-hidden="true"
        className={cm(styles, "port-output-locator-svg")}
        focusable="false"
        preserveAspectRatio="xMidYMid meet"
        viewBox={model.viewBox}
      >
        <rect
          className={cm(styles, "port-output-locator-body")}
          height={model.footprint.height}
          rx="0.18"
          width={model.footprint.width}
          x="0"
          y="0"
        />
        {model.markers.map((marker) => (
          <circle
            className={cm(styles, "port-output-locator-marker")}
            cx={marker.x}
            cy={marker.y}
            data-port-id={marker.portId}
            key={`${marker.groupId}:${marker.portId}`}
            r="0.13"
          />
        ))}
        {model.selectedPolylinePoints === null ? null : (
          <polyline
            className={cm(styles, "port-output-locator-selected-line")}
            points={model.selectedPolylinePoints}
          />
        )}
        {model.selectedMarkers.map((marker) => (
          <circle
            className={cm(styles, "port-output-locator-selected-marker")}
            cx={marker.x}
            cy={marker.y}
            data-selected-port-id={marker.portId}
            key={`${marker.groupId}:${marker.portId}:selected`}
            r="0.25"
          />
        ))}
      </svg>
      <span className={cm(styles, "port-output-locator-label")}>{portLabel}</span>
    </span>
  );
}

function resolveLocatorModel(options: {
  readonly definition: EntityDefinition;
  readonly rows: readonly OutputGroupRow[];
  readonly rotation: GridRotation;
  readonly targetPortGroupId: string;
}): LocatorModel {
  const footprint = getRotatedGridFootprint(
    options.definition.footprint,
    options.rotation,
  );
  const markers = options.rows.flatMap((row) =>
    row.portGroup.ports.map((port) => {
      const geometry = resolveRotatedPortGeometry({
        footprint: options.definition.footprint,
        port,
        rotation: options.rotation,
      });

      return {
        groupId: row.portGroup.id,
        portId: port.id,
        x: geometry.anchor.x,
        y: geometry.anchor.y,
      };
    }),
  );
  const selectedMarkers = markers.filter((marker) =>
    marker.groupId === options.targetPortGroupId,
  );

  return {
    footprint,
    viewBox: resolveLocatorViewBox(footprint),
    markers,
    selectedMarkers,
    selectedPolylinePoints: resolveSelectedPolylinePoints(selectedMarkers),
  };
}

function resolveLocatorViewBox(footprint: { readonly width: number; readonly height: number }): string {
  const padding = 0.72;
  return [
    -padding,
    -padding,
    footprint.width + padding * 2,
    footprint.height + padding * 2,
  ].join(" ");
}

function resolveSelectedPolylinePoints(markers: readonly LocatorMarker[]): string | null {
  if (markers.length < 2) {
    return null;
  }

  return [...markers]
    .sort((left, right) => left.x === right.x ? left.y - right.y : left.x - right.x)
    .map((marker) => `${marker.x},${marker.y}`)
    .join(" ");
}
