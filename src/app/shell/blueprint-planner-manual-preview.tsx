import { useId } from "react";
import { observer } from "mobx-react-lite";
import type { AppHost } from "../host";
import styles from "./blueprint-planner-manual-preview.module.scss";

/** 选项说明使用规范方向的示例，不投影实际设备，不参与空间校验或求解。 */
export const BlueprintPlannerManualPreview = observer(function BlueprintPlannerManualPreview({ appHost }: { appHost: AppHost }) {
  const gridId = useId();
  const controller = appHost.blueprintPlannerDialog, layout = controller.manual.layout, t = appHost.actions.translate;
  if (!layout?.enabled) return <p className={styles.disabled}>{t("eda.manual.preview.disabled")}</p>;
  if (!controller.manual.hasCurrentLayoutFormat) return null;
  const position = layout.boundary.position, limits = controller.options.dimensionLimits;
  const fixed = layout.orientation === "fixed";
  const xLocked = fixed && !!position && (position.left !== null || position.right !== null);
  const yLocked = fixed && !!position && (position.base !== null || position.top != null);
  const sides = {
    left: fixed && (!!position && position.left !== null || xLocked && limits?.exactBaseLength !== undefined),
    right: fixed && (!!position && position.right !== null || xLocked && limits?.exactBaseLength !== undefined),
    base: fixed && (!!position && position.base !== null || yLocked && limits?.exactSideLength !== undefined),
    top: fixed && (!!position && position.top != null || yLocked && limits?.exactSideLength !== undefined),
  };
  const paths = { left: "M30 19V139", right: "M284 19V139", base: "M20 129H300", top: "M20 29H300" };
  return <section className={styles.preview} data-manual-preview={position ? "boundary" : `relative-${layout.orientation}`} aria-label={t("eda.manual.preview.title")}>
    <figure><svg viewBox="0 0 330 170" role="img" aria-label={t("eda.manual.preview.example")}>
      <defs><pattern id={gridId} x="30" y="29" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M10 0H0V10" className={styles.grid} /></pattern></defs>
      <rect data-preview-grid="10" x="20" y="19" width="280" height="120" fill={`url(#${gridId})`} />
      {(Object.keys(sides) as (keyof typeof sides)[]).map(side => {
        const reference = fixed && (side === "left" || side === "right" ? limits?.exactBaseLength !== undefined || limits?.maxBaseLength !== undefined : limits?.exactSideLength !== undefined || limits?.maxSideLength !== undefined);
        return sides[side] || reference ? <path key={side} data-preview-boundary={sides[side] ? side : undefined}
          data-preview-reference={!sides[side] ? side : undefined} d={paths[side]} className={sides[side] ? styles.side : `${styles.side} ${styles.derived}`} /> : null;
      })}
      {!xLocked ? <path data-preview-motion="x" d="M115 49H215m-94-4-6 4 6 4m88-8 6 4-6 4" className={styles.motion} /> : null}
      {!yLocked ? <path data-preview-motion="y" d="M50 49V105m-4-50 4-6 4 6m-8 44 4 6 4-6" className={styles.motion} /> : null}
      {!fixed ? <path data-preview-motion="rotation" d="M245 46a20 20 0 1 1-15 25m-1-8 1 8 8-1" className={styles.motion} /> : null}
      <rect x="80" y="69" width="50" height="30" rx="3" className={styles.device} /><rect x="180" y="69" width="50" height="30" rx="3" className={styles.device} />
      <text x="106" y="91" textAnchor="middle" className={styles.deviceText}>A</text><text x="207" y="91" textAnchor="middle" className={styles.deviceText}>B</text>
    </svg><figcaption>{t("eda.manual.preview.example")}</figcaption></figure>
    <div className={styles.explanation}>
      <p data-preview-dimensions="">{(["base", "side"] as const).map(axis => {
        const exact = axis === "base" ? limits?.exactBaseLength : limits?.exactSideLength;
        const max = axis === "base" ? limits?.maxBaseLength : limits?.maxSideLength;
        return exact !== undefined ? `${t(`eda.dimensions.${axis}.exact`)}: ${exact}` : max !== undefined ? `${t(`eda.dimensions.${axis}.max`)}: ${max}` : `${t(`eda.dimensions.${axis}Axis`)}: ${t("eda.dimensions.mode.none")}`;
      }).join(" · ")}</p>
      {/* AI-CORRECTION 2026-11-21：说明按每轴真实定位自由度派生，锁边时不可宣称双轴自由平移。
          Original code: <p>{t(fixed ? "eda.manual.preview.relativeFixed" : "eda.manual.preview.relativeFree")}</p> */}
      <p>{t(!fixed ? "eda.manual.preview.relativeFree" : !xLocked && !yLocked ? "eda.manual.preview.relativeFixed"
        : xLocked && yLocked ? "eda.manual.preview.fixedBoth" : xLocked ? "eda.manual.preview.fixedX" : "eda.manual.preview.fixedY")}</p>
      {position ? <p>{(["x", "y"] as const).map(axis => `${t(`eda.manual.axis.${axis}`)}: ${t(`eda.manual.axis.${controller.manual.axisPositionMode(axis)}`)}`).join(" · ")}</p> : null}
      {xLocked || yLocked ? <p>{t("eda.manual.preview.moveDistance")}</p> : null}
      {limits?.maxBaseLength !== undefined || limits?.maxSideLength !== undefined ? <p>{t("eda.manual.preview.maximum")}</p> : null}
      <p>{t(`eda.manual.preview.binding.${layout.mode}`)}</p>
      <p>{t("eda.manual.preview.nextDirection")}</p>
    </div>
  </section>;
});

// AI-REMOVED 2026-11-21:
// Reason: 双轴自由度取代底边必锁定示意。
// Trigger: REQ-051 最新订正。
// Evidence: X/Y独立选择并允许双自由。
// Replacement: 上方。
// Risk: Low。
// Human Review: Required
// Original code:
// /** 选项说明使用规范方向的示例，不投影实际设备，不参与空间校验或求解。 */
// export const BlueprintPlannerManualPreview = observer(function BlueprintPlannerManualPreview({ appHost }: { appHost: AppHost }) {
//   const gridId = useId();
//   const controller = appHost.blueprintPlannerDialog, layout = controller.manual.layout, t = appHost.actions.translate;
//   if (!layout?.enabled) return <p className={styles.disabled}>{t("eda.manual.preview.disabled")}</p>;
//   if (!controller.manual.hasCurrentLayoutFormat) return null;
//   const position = layout.boundary.position, limits = controller.options.dimensionLimits;
//   const absolute = position !== null;
//   const left = position?.left !== null && position?.left !== undefined;
//   const right = position?.right !== null && position?.right !== undefined;
//   const derivedLeft = absolute && !left && right && limits?.exactBaseLength !== undefined;
//   const derivedRight = absolute && !right && left && limits?.exactBaseLength !== undefined;
//   const top = absolute && limits?.exactSideLength !== undefined;
//   const sideMode = left && right ? "both" : left || right ? "single" : "none";
//   return <section className={styles.preview} data-manual-preview={absolute ? `absolute-${sideMode}` : `relative-${layout.orientation}`} aria-label={t("eda.manual.preview.title")}>
//     <figure>
//       <svg viewBox="0 0 330 170" role="img" aria-label={t("eda.manual.preview.example")}>
//         {/* AI-REMOVED 2026-11-21: Reason: 闭合虚线框会把开放边误示为固定边。
//             Trigger: 预览审查。Evidence: 相对/开放侧边仍有四边轮廓。
//             Replacement: 下方10单位网格。Risk: Low。Human Review: Required
//             Original code: <rect x="30" y="25" width="254" height="104" rx="3" className={styles.area} /> */}
//         <defs><pattern id={gridId} x="30" y="29" width="10" height="10" patternUnits="userSpaceOnUse">
//           <path d="M10 0H0V10" className={styles.grid} />
//         </pattern></defs>
//         <rect data-preview-grid="10" x="20" y="19" width="280" height="120" fill={`url(#${gridId})`} />
//         {absolute ? <>
//           <path data-preview-boundary="base" d="M20 129H300" className={styles.base} />
//           {left || derivedLeft ? <path data-preview-boundary="left" data-derived={derivedLeft || undefined} d="M30 18V140" className={`${styles.side} ${derivedLeft ? styles.derived : ""}`} /> : null}
//           {right || derivedRight ? <path data-preview-boundary="right" data-derived={derivedRight || undefined} d="M284 18V140" className={`${styles.side} ${derivedRight ? styles.derived : ""}`} /> : null}
//           {top ? <path data-preview-boundary="top" data-derived="true" d="M30 25H284" className={`${styles.side} ${styles.derived}`} /> : null}
//           {sideMode === "none" ? <path data-preview-motion="parallel" d="M115 49H215m-94-4-6 4 6 4m88-8 6 4-6 4" className={styles.motion} /> : null}
//           <path d="M139 99V129m-4-25 4-5 4 5m-8 20 4 5 4-5" className={styles.distance} />
//           <text x="149" y="118" className={styles.distanceText}>{t("eda.manual.preview.threeCells")}</text>
//           <text x="165" y="157" textAnchor="middle" className={styles.baseText}>{t("eda.manual.preview.base")}</text>
//         </> : <>
//           <path d="M50 49H93m-6-4 6 4-6 4M50 49V85m-4-6 4 6 4-6" className={styles.motion} />
//           {layout.orientation === "free" ? <path d="M235 46a20 20 0 1 1-15 25m-1-8 1 8 8-1" className={styles.motion} /> : null}
//         </>}
//         <rect x="80" y="69" width="50" height="30" rx="3" className={styles.device} />
//         <rect x="180" y="69" width="50" height="30" rx="3" className={styles.device} />
//         <text x="106" y="91" textAnchor="middle" className={styles.deviceText}>A</text>
//         <text x="207" y="91" textAnchor="middle" className={styles.deviceText}>B</text>
//       </svg>
//       <figcaption>{t("eda.manual.preview.example")}</figcaption>
//     </figure>
//     <div className={styles.explanation}>
//       <p data-preview-dimensions="">{(["base", "side"] as const).map(axis => {
//         const exact = axis === "base" ? limits?.exactBaseLength : limits?.exactSideLength;
//         const max = axis === "base" ? limits?.maxBaseLength : limits?.maxSideLength;
//         return exact !== undefined ? `${t(`eda.dimensions.${axis}.exact`)}: ${exact}`
//           : max !== undefined ? `${t(`eda.dimensions.${axis}.max`)}: ${max}`
//           : `${t(`eda.dimensions.${axis}Axis`)}: ${t("eda.dimensions.mode.none")}`;
//       }).join(" · ")}</p>
//       <p>{t(absolute ? `eda.manual.preview.absolute.${sideMode}` : layout.orientation === "free" ? "eda.manual.preview.relativeFree" : "eda.manual.preview.relativeFixed")}</p>
//       {absolute ? <p>{t("eda.manual.preview.moveDistance")}</p> : null}
//       {derivedLeft || derivedRight ? <p>{t("eda.manual.preview.derivedSide")}</p> : null}
//       {top ? <p>{t("eda.manual.preview.exactDepth")}</p> : null}
//       {limits?.maxBaseLength !== undefined || limits?.maxSideLength !== undefined ? <p>{t("eda.manual.preview.maximum")}</p> : null}
//       <p>{t(`eda.manual.preview.binding.${layout.mode}`)}</p>
//       {absolute ? <p>{t("eda.manual.preview.nextDirection")}</p> : null}
//     </div>
//   </section>;
// });
