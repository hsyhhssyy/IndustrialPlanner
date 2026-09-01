import type { CSSProperties } from "react";

import styles from "./composite-item-icon.module.scss";

export function CompositeItemIcon({
  className = "",
  iconSrcs,
  size,
}: {
  readonly className?: string;
  readonly iconSrcs: readonly string[];
  readonly size?: number | string;
}) {
  const visibleIconSrcs = iconSrcs.slice(0, 4);
  const style = size === undefined
    ? undefined
    : {
      "--composite-item-icon-size": typeof size === "number" ? `${size}px` : size,
    } as CSSProperties;

  return (
    <span
      aria-hidden="true"
      className={`${styles.root} ${styles[`count-${visibleIconSrcs.length}`] ?? ""} ${className}`.trim()}
      style={style}
    >
      {visibleIconSrcs.map((src, index) => (
        <img alt="" className={styles.tile} key={`${index}:${src}`} src={src} />
      ))}
    </span>
  );
}
