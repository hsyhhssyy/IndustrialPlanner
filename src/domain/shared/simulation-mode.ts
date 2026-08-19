/** 仿真编译与运行模式。模式只允许在仿真停止时切换。 */
export const SIMULATION_MODE = {
  singleBase: "single-base",
  regionalMultiBase: "regional-multi-base",
} as const;

export type SimulationMode = typeof SIMULATION_MODE[keyof typeof SIMULATION_MODE];

export const SIMULATION_MODES: readonly SimulationMode[] = [
  SIMULATION_MODE.singleBase,
  SIMULATION_MODE.regionalMultiBase,
];
