import type { SimulationDeviceRuntimeStatus } from "@/domain/types/simulation";

export const SIMULATION_RUNTIME_INSPECTOR_KEY = "simulation-runtime-inspecotr";

export function resolveSimulationRuntimeProgressPercent(
  runtimeStatus: SimulationDeviceRuntimeStatus | null,
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

export function SimulationRuntimeInspector({
  runtimeStatus,
}: {
  runtimeStatus: SimulationDeviceRuntimeStatus | null;
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
    </article>
  );
}
