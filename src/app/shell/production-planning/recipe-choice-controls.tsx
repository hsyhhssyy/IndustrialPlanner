import type { RecipeDefinition } from "@/domain/registry/types/recipe-definition";
import LucideRepeat from "~icons/lucide/repeat";
import LucideListTree from "~icons/lucide/list-tree";
import { cm } from "../shared";
import { resolveProductionPlanningCandidateName, type ProductionPlanningIndex } from "./production-planning-model";
import { normalizeProductionPlanningCandidateChoiceId, type ProductionPlanningCandidate } from "./production-planning-candidate";

export function RecipeChoiceControls({
  styles,
  itemId,
  recipes,
  candidates,
  index,
  selectedRecipeId,
  onRequestRecipeSelection,
  onSelectRecipe,
  t,
}: {
  styles: Readonly<Record<string, string>>;
  itemId: string;
  recipes: readonly RecipeDefinition[];
  candidates: readonly ProductionPlanningCandidate[];
  index: ProductionPlanningIndex;
  selectedRecipeId: string | null;
  onRequestRecipeSelection: (itemId: string, recipes: readonly RecipeDefinition[]) => void;
  onSelectRecipe: (itemId: string, recipeId: string | null) => void;
  t: (key: string) => string;
}) {
  if (itemId.length === 0 || candidates.length <= 1) {
    return null;
  }

  const normalizedSelectedCandidateId = selectedRecipeId === null
    ? null
    : normalizeProductionPlanningCandidateChoiceId(selectedRecipeId);
  // 2026-11-25：对话框或旧持久化返回分支配方 ID 时，下拉必须高亮对应的概率组。
  const selectedMemberRecipeId = normalizedSelectedCandidateId?.startsWith("recipe:")
    ? normalizedSelectedCandidateId.slice("recipe:".length)
    : null;
  const selectedGroupCandidateId = selectedMemberRecipeId === null
    ? undefined
    : index.probabilityGroupByMemberRecipeId.get(selectedMemberRecipeId);
  const selectedCandidate = normalizedSelectedCandidateId === null
    ? null
    : candidates.find((candidate) => candidate.id === (selectedGroupCandidateId ?? normalizedSelectedCandidateId)) ?? null;
  const label = selectedCandidate === null
    ? t("productionPlanning.autoRecipe")
    : resolveProductionPlanningCandidateName(selectedCandidate, index, t);

  return (
    <div className={cm(styles, "production-planning-recipe-choice")}>
      <div className={cm(styles, "production-planning-recipe-choice-summary")}>
        <span>{t("productionPlanning.productionCandidate")}</span>
        <strong>{label}</strong>
      </div>
      <select
        className={cm(styles, "production-planning-recipe-choice-candidate")}
        aria-label={t("productionPlanning.productionCandidate")}
        value={selectedCandidate?.id ?? ""}
        onChange={(event) => onSelectRecipe(itemId, event.currentTarget.value || null)}
      >
        <option value="">{t("productionPlanning.autoRecipe")}</option>
        {candidates.map((candidate) => (
          <option key={candidate.id} value={candidate.id}>
            {resolveProductionPlanningCandidateName(candidate, index, t)}
          </option>
        ))}
      </select>
      <button
        type="button"
        className={cm(styles, "production-planning-icon-text-button production-planning-recipe-choice-compact-auto")}
        aria-pressed={selectedCandidate === null}
        onClick={() => onSelectRecipe(itemId, null)}
      >
        <LucideRepeat />
        <span>{t("productionPlanning.autoRecipe")}</span>
      </button>
      {recipes.length > 1 && (
        <button
          type="button"
          className={cm(styles, "production-planning-icon-text-button production-planning-recipe-choice-select")}
          onClick={() => onRequestRecipeSelection(itemId, recipes)}
        >
          <LucideListTree />
          <span>{t("productionPlanning.chooseRecipe")}</span>
        </button>
      )}
    </div>
  );
}

