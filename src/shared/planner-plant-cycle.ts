import type { RecipeDefinition } from "@/domain/registry/types/recipe-definition";

const EPSILON = 1e-6;

export function isPlantCycleRecipe(recipe: RecipeDefinition): boolean {
  return ["seedcol_1", "planter_1", "planter_1_liquid"].includes(recipe.machineId);
}

/** 两配方植物回路按净外供配平；已有速率只参与扩产后的设备支路数量计算。 */
export function resolveProductivePlantCycleRate(input: {
  readonly recipe: RecipeDefinition;
  readonly partnerRecipe: RecipeDefinition;
  readonly itemId: string;
  readonly externalDemand: number;
  readonly availablePartnerSupply: number;
  readonly outputPerCycle?: number;
  readonly existingCyclesPerMinute?: number;
  readonly existingPartnerCyclesPerMinute?: number;
}): { cyclesPerMinute: number; partnerCyclesPerMinute: number; partnerItemId: string;
  minimumDeviceCount: number; minimumPartnerDeviceCount: number } | null {
  const { recipe, partnerRecipe, itemId } = input;
  if (!isPlantCycleRecipe(recipe) || !isPlantCycleRecipe(partnerRecipe)
    || (recipe.machineId === "seedcol_1") === (partnerRecipe.machineId === "seedcol_1")) return null;
  const output = recipe.outputs.find(port => port.itemId === itemId);
  const partnerInput = recipe.inputs.find(port => partnerRecipe.outputs.some(out => out.itemId === port.itemId));
  const partnerOutput = partnerRecipe.outputs.find(port => port.itemId === partnerInput?.itemId);
  const feedbackInput = partnerRecipe.inputs.find(port => port.itemId === itemId);
  if (!output || !partnerInput || !partnerOutput || !feedbackInput
    || partnerOutput.amount <= EPSILON || partnerInput.amount <= EPSILON || feedbackInput.amount <= EPSILON) return null;
  const outputPerCycle = input.outputPerCycle ?? output.amount;
  const feedbackPerCycle = partnerInput.amount * feedbackInput.amount / partnerOutput.amount;
  const netOutputPerCycle = outputPerCycle - feedbackPerCycle;
  if (netOutputPerCycle <= EPSILON) return null;
  const available = Math.max(0, input.availablePartnerSupply);
  const cyclesPerMinute = Math.max(input.externalDemand / outputPerCycle,
    (input.externalDemand - available * feedbackInput.amount / partnerOutput.amount) / netOutputPerCycle);
  const partnerCyclesPerMinute = Math.max(0, (partnerInput.amount * cyclesPerMinute - available) / partnerOutput.amount);
  const feedbackPerMinute = ((input.existingPartnerCyclesPerMinute ?? 0) + partnerCyclesPerMinute) * feedbackInput.amount;
  const totalOutputPerMinute = ((input.existingCyclesPerMinute ?? 0) + cyclesPerMinute) * outputPerCycle;
  const outputCapacity = output.amount * 60 / recipe.durationSeconds;
  // 采种增产时，种植回流与对外输出各占独立设备支路。
  const minimumDeviceCount = recipe.machineId !== "seedcol_1" && partnerOutput.amount > feedbackInput.amount + EPSILON
    && outputCapacity > EPSILON
    ? Math.max(0, Math.ceil(feedbackPerMinute / outputCapacity - EPSILON))
      + Math.max(0, Math.ceil((totalOutputPerMinute - feedbackPerMinute) / outputCapacity - EPSILON))
    : 0;
  const partnerFeedbackPerMinute = ((input.existingCyclesPerMinute ?? 0) + cyclesPerMinute) * partnerInput.amount;
  const partnerTotalOutputPerMinute = ((input.existingPartnerCyclesPerMinute ?? 0) + partnerCyclesPerMinute) * partnerOutput.amount;
  const partnerOutputCapacity = partnerOutput.amount * 60 / partnerRecipe.durationSeconds;
  const minimumPartnerDeviceCount = partnerRecipe.machineId !== "seedcol_1" && output.amount > partnerInput.amount + EPSILON
    && partnerOutputCapacity > EPSILON
    ? Math.max(0, Math.ceil(partnerFeedbackPerMinute / partnerOutputCapacity - EPSILON))
      + Math.max(0, Math.ceil((partnerTotalOutputPerMinute - partnerFeedbackPerMinute) / partnerOutputCapacity - EPSILON))
    : 0;
  return { cyclesPerMinute, partnerCyclesPerMinute, partnerItemId: partnerInput.itemId, minimumDeviceCount, minimumPartnerDeviceCount };
}
