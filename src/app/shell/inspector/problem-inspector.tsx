import { observer } from "mobx-react-lite";
import type { AppHost } from "@/app/host/app-host";
import type { WorldEntity } from "@/domain/document/world-document";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import type { SimulationDeviceRuntimeStatusReadModel } from "@/domain/simulation/types/simulation-types";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";

export const PROBLEM_INSPECTOR_KEY = "problem-inspector";

interface DeviceProblem {
  readonly message: string;
  readonly severity: "error" | "warning";
}

function collectPlacementProblems(
  appHost: AppHost,
  entity: WorldEntity,
): DeviceProblem[] {
  const editor = appHost.workspace.editor;
  if (editor === null) return [];

  const validation = editor.queries.getEntityPlacementValidation(entity.id);
  if (validation.canPlace) return [];

  return validation.reasons.map((reason) => ({
    message: reason.message,
    severity: "error" as const,
  }));
}

function collectPowerProblems(
  appHost: AppHost,
  runtimeStatus: SimulationDeviceRuntimeStatusReadModel | null,
): DeviceProblem[] {
  const problems: DeviceProblem[] = [];

  if (runtimeStatus === null) return problems;

  // 设备不在供电范围
  if (runtimeStatus.powerStatus === "out-of-power-range") {
    problems.push({
      message: "该设备不在供电范围",
      severity: "error",
    });
  }

  // 地图电力不足（基地级大停电）
  const docStatus = appHost.workspace.simulation?.queries.getDocumentRuntimeStatus();
  if (docStatus?.isPowerOutage && runtimeStatus.powerStatus !== "no-power-needed") {
    problems.push({
      message: "电力不足",
      severity: "error",
    });
  }

  return problems;
}

function collectRecipeProblems(
  runtimeStatus: SimulationDeviceRuntimeStatusReadModel | null,
): DeviceProblem[] {
  if (runtimeStatus === null) return [];

  const problems: DeviceProblem[] = [];

  for (const chStatus of Object.values(runtimeStatus.channelRecipes)) {
    if (chStatus === null) continue;
    // waiting-output 且已累积满进度 → 产物堵塞
    if (
      chStatus.state === "waiting-output" &&
      chStatus.progressSeconds !== null &&
      chStatus.desiredSeconds !== null &&
      chStatus.progressSeconds >= chStatus.desiredSeconds
    ) {
      problems.push({
        message: "产物堵塞",
        severity: "error",
      });
    }
  }

  return problems;
}

export const ProblemInspector = observer(function ProblemInspector({
  appHost,
  entity,
  definition: _definition,
  runtimeStatus,
}: {
  appHost: AppHost;
  entity: WorldEntity;
  definition: EntityDefinition;
  runtimeStatus: SimulationDeviceRuntimeStatusReadModel | null;
}) {
  const placementProblems = collectPlacementProblems(appHost, entity);
  const powerProblems = collectPowerProblems(appHost, runtimeStatus);
  const recipeProblems = collectRecipeProblems(runtimeStatus);

  const allProblems = [...placementProblems, ...powerProblems, ...recipeProblems];

  if (allProblems.length === 0) {
    return null;
  }

  return (
    <div
      className={cm(styles, "definition-list")}
      data-inspector-key={PROBLEM_INSPECTOR_KEY}
    >
      {allProblems.map((problem, index) => (
        <article
          className={cm(styles, "definition-card")}
          key={`${problem.severity}-${index}`}
          data-problem-severity={problem.severity}
        >
          <p>{problem.message}</p>
        </article>
      ))}
    </div>
  );
});
