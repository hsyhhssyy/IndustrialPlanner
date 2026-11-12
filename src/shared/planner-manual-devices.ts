/** 人工布局的设备范围；界面和规划校验共用，旧任务也不能绕过产品限制。 */
export function isPlannerManualDeviceSupported(definitionId: string): boolean {
  return definitionId !== "power_sta_1" && definitionId !== "squirter_1" && !definitionId.startsWith("soil_");
}
