import { useId, useState, type ComponentPropsWithRef, type ReactNode, type Ref } from "react";
import ChevronDown from "~icons/lucide/chevron-down";
import styles from "./placement-palette-row.module.scss";

export interface PlacementPaletteRowProps {
  readonly label: string;
  readonly iconSrc?: string;
  readonly products?: readonly { readonly src: string; readonly label: string }[];
  readonly count?: number | null;
  readonly badge?: string;
  readonly appearance?: "default" | "compact";
  readonly interactive?: boolean;
  readonly className?: string;
  readonly iconClassName?: string;
  readonly imageClassName?: string;
  readonly labelClassName?: string;
  readonly rootRef?: Ref<HTMLDivElement>;
  readonly buttonProps?: ComponentPropsWithRef<"button"> & { readonly [key: `data-${string}`]: string | number | boolean | undefined };
  readonly buttonSuffix?: ReactNode;
  readonly children?: ReactNode;
}

/** 放置入口的共享外观；数量在按钮外，数据来源、放置手势及展开动作由调用方持有。 */
export function PlacementPaletteRow({ label, iconSrc, products = [], count, badge, appearance = "default",
  className, iconClassName, imageClassName, labelClassName, rootRef, buttonProps, buttonSuffix, children, interactive = true }: PlacementPaletteRowProps) {
  // AI-REMOVED 2026-11-13:
  // Reason: 联合标签无法保留按钮 ref 的具体类型。Trigger: TypeScript 编译失败。
  // Evidence: TS2322；Replacement: 下方共享内容与具体标签分支。Risk: Low。Human Review: Required。
  // Original code:
  // const RowContent = interactive ? "button" : "div";
  const content = <>
      <span className={iconClassName ?? styles.icon} aria-hidden="true">
        <img className={imageClassName} alt="" src={iconSrc} />
      </span>
      {products.length ? <span className={styles.products}>{products.slice(0, 2).map((product, index) =>
        <img key={`${product.src}/${index}`} src={product.src} alt={product.label} title={product.label} />)}
        {products.length > 2 ? <span className={styles.moreProducts} title={products.slice(2).map(product => product.label).join("、")}
          aria-label={products.slice(2).map(product => product.label).join("、")}>+{products.length - 2}</span> : null}
      </span> : null}
      <span className={labelClassName ?? styles.label}>{label}</span>
      {badge ? <span className={styles.badge}>{badge}</span> : null}
      {buttonSuffix}
  </>;
  const contentClass = [styles.button, buttonProps?.className].filter(Boolean).join(" ");
  return <div ref={rootRef} className={[styles.row, className].filter(Boolean).join(" ")} data-appearance={appearance} data-interactive={interactive}>
    {count !== undefined && count !== null ? <span className={styles.count}>{count}</span> : null}
    {interactive ? <button type="button" title={label} {...buttonProps} className={contentClass}>{content}</button>
      : <div title={label} className={contentClass}>{content}</div>}
    {children}
  </div>;
}

/** 多个可选条目共用同一展开行；单条目由调用方直接使用 PlacementPaletteRow。 */
export function PlacementPaletteGroup({ children, ...props }: Omit<PlacementPaletteRowProps, "buttonSuffix">) {
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();
  return <div className={styles.group}>
    <PlacementPaletteRow {...props} buttonProps={{ ...props.buttonProps, "aria-expanded": expanded, "aria-controls": contentId,
      onClick: () => setExpanded(value => !value) }} buttonSuffix={<ChevronDown aria-hidden="true" className={styles.chevron} />} />
    <div id={contentId} className={styles.entries} hidden={!expanded}>{children}</div>
  </div>;
}
