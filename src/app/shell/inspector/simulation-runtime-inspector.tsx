import type {
  SimulationDeviceRuntimeStatusReadModel,
  SimulationDeviceRuntimeSlotItemReadModel,
} from "@/domain/query/simulation-query";

export const SIMULATION_RUNTIME_INSPECTOR_KEY = "simulation-runtime-inspecotr";

export function resolveSimulationRuntimeProgressPercent(
  runtimeStatus: SimulationDeviceRuntimeStatusReadModel | null,
): number | null {
  if (runtimeStatus === null) {
    return null;
  }

  const { desiredSeconds, progressSeconds } = runtimeStatus;
  if (progressSeconds === null || desiredSeconds === null || desiredSeconds <= 0) {
    return null;
  }

  const progressPercent = progressSeconds / desiredSeconds * 100;
  if (!Number.isFinite(progressPercent)) {
    return null;
  }

  return Math.max(0, Math.min(100, progressPercent));
}

function formatRuntimeValue(value: string | number | null): string {
  return value === null ? "null" : String(value);
}

function formatProgressPercent(progressPercent: number | null): string {
  if (progressPercent === null) {
    return "null";
  }

  const formatted = Number.isInteger(progressPercent)
    ? String(progressPercent)
    : progressPercent.toFixed(1);

  return `${formatted}%`;
}

function formatSlotItemLabel(slotItem: SimulationDeviceRuntimeSlotItemReadModel): string {
  if (slotItem.viewRole === "single-view") {
    return `${slotItem.storageGroupId}.${slotItem.slotId}`;
  }

  return `${slotItem.storageGroupId}.${slotItem.slotId}.${slotItem.viewRole}`;
}

function formatReservedItems(slotItem: SimulationDeviceRuntimeSlotItemReadModel): string | null {
  if (slotItem.reserved <= 0) {
    return null;
  }

  return String(slotItem.reserved);
}

function formatSlotItemValue(slotItem: SimulationDeviceRuntimeSlotItemReadModel): string {
  const reserved = formatReservedItems(slotItem);
  const segments = [`item=${formatRuntimeValue(slotItem.itemType)}`, `count=${slotItem.count}`];
  if (reserved !== null) {
    segments.push(`reserved=${reserved}`);
  }
  return segments.join(", ");
}

export function SimulationRuntimeInspector({
  runtimeStatus,
}: {
  runtimeStatus: SimulationDeviceRuntimeStatusReadModel | null;
}) {
  const progressPercent = resolveSimulationRuntimeProgressPercent(runtimeStatus);
  const rows = [
    {
      field: "recipeId",
      value: formatRuntimeValue(runtimeStatus?.recipeId ?? null),
    },
    {
      field: "progressSeconds",
      value: formatRuntimeValue(runtimeStatus?.progressSeconds ?? null),
    },
    {
      field: "desiredSeconds",
      value: formatRuntimeValue(runtimeStatus?.desiredSeconds ?? null),
    },
    {
      field: "progressPercent",
      value: formatProgressPercent(progressPercent),
    },
  ];
  const slotItems = runtimeStatus?.slotItems ?? [];

  return (
    <article
      className="definition-card simulation-runtime-inspector"
      data-inspector-key={SIMULATION_RUNTIME_INSPECTOR_KEY}
    >
      <h4>仿真运行态</h4>
      <dl className="kv-grid">
        {rows.map((row) => (
          <div className="kv" data-runtime-field={row.field} key={row.field}>
            <dt>{row.field}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
      <h5>slotItems</h5>
      {runtimeStatus === null ? (
        <p>null</p>
      ) : slotItems.length === 0 ? (
        <p>[]</p>
      ) : (
        <dl className="kv-grid">
          {slotItems.map((slotItem) => {
            const label = formatSlotItemLabel(slotItem);
            return (
              <div className="kv" data-runtime-slot={label} key={label}>
                <dt>{label}</dt>
                <dd>{formatSlotItemValue(slotItem)}</dd>
              </div>
            );
          })}
        </dl>
      )}
    </article>
  );
}
