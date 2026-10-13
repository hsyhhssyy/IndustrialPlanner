import type { GridRect } from "../../shared/grid";

/** 设备 rotation=0 时、相对占地左上角的作用范围；随设备整体旋转。 */
export interface EntityRangeDefinition {
  /** 同一设备定义内唯一；配方通过此 ID 引用范围。 */
  readonly id: string;
  readonly localRect: GridRect;
  readonly coverage: "intersects" | "contains";
  /** 未声明时仅展示范围，不参与设备关联高亮。 */
  readonly interactionKind?: "power" | "gas" | "irrigation";
  readonly visualId: string;
}
