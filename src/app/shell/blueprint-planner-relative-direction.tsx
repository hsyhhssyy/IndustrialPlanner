// AI-REMOVED 2026-11-21:
// Reason: 双帧方向示意已由固定屏幕单图交互替代，无活动调用。
// Trigger: 第二步交互图收敛。Evidence: boundary.tsx仅保留审计import，无其他引用。
// Replacement: blueprint-planner-boundary.tsx。Risk: Low。Human Review: Required
// Original code:
// import type { GridRotation } from "@/domain/shared/grid";
// import styles from "./blueprint-planner-relative-direction.module.scss";
//
// /** 只读关系示意：旋转整个设备组与底边，不将相对侧画成固定世界方向。 */
// export function BlueprintPlannerRelativeDirectionPreview({ direction, translate: t }: {
//   direction: GridRotation | null; translate: (key: string) => string;
// }) {
//   const devices = <g data-device-group="true" className={styles.devices}>
//     <rect x="-24" y="-19" width="27" height="20" rx="2" />
//     <rect x="8" y="-12" width="16" height="31" rx="2" />
//     <rect x="-20" y="6" width="18" height="13" rx="2" />
//   </g>;
//   return <div className={styles.preview} data-relative-direction-preview="true" data-automatic={direction === null}>
//     <strong>{t("eda.manual.direction.example")}</strong>
//     {direction === null ? <>
//       <svg viewBox="-48 -40 96 80" role="img" aria-label={t("eda.manual.direction.group")} className={styles.automaticGroup}>{devices}</svg>
//       <p>{t("eda.manual.direction.relativeAuto")}</p>
//     </> : <>
//       <p>{t("eda.manual.direction.relativeReference")}</p>
//       <div className={styles.frames}>
//         {([0, 90] as const).map(rotation => <figure key={rotation} data-direction-frame={rotation === 0 ? "current" : "rotated"}>
//           <svg viewBox="-48 -48 96 96" role="img" aria-label={t(rotation === 0 ? "eda.manual.direction.currentGroup" : "eda.manual.direction.rotatedGroup")}>
//             <g transform={`rotate(${rotation})`} data-group-rotation={rotation}>
//               {devices}
//               <g transform={`rotate(${direction})`} className={styles.base} data-base-direction={direction}>
//                 <path d="M-32 29H32" />
//                 <path d="M0 21V29" className={styles.gap} />
//               </g>
//             </g>
//           </svg>
//           <figcaption>{t(rotation === 0 ? "eda.manual.direction.currentGroup" : "eda.manual.direction.rotatedGroup")}</figcaption>
//         </figure>)}
//         <span className={styles.arrow} aria-hidden="true">→</span>
//       </div>
//       <p>{t("eda.manual.direction.rotateTogether")}</p>
//     </>}
//   </div>;
// }
