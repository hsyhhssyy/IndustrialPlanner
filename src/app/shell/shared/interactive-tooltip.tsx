import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject, type MouseEvent, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import styles from "./interactive-tooltip.module.scss";

interface TooltipTrigger<T extends HTMLElement> {
  readonly ref: RefObject<T | null>;
  readonly "aria-describedby": string | undefined;
  readonly "aria-expanded": boolean;
  readonly onMouseEnter: () => void;
  readonly onMouseLeave: () => void;
  readonly onFocus: () => void;
  readonly onBlur: () => void;
  readonly onClick: (event: MouseEvent<T>) => void;
  readonly onKeyDown: (event: KeyboardEvent<T>) => void;
}

/** 从仓库存量锁定按钮提取：hover、焦点和触屏固定共用同一 portal 与视口定位。 */
export function InteractiveTooltip<T extends HTMLElement>({ text, children, className, dataAttributes }: {
  readonly text: string;
  readonly children: (trigger: TooltipTrigger<T>) => ReactNode;
  readonly className?: string;
  readonly dataAttributes?: Readonly<Record<string, string>>;
}) {
  const id = useId(), anchor = useRef<T | null>(null), tooltip = useRef<HTMLDivElement | null>(null);
  const [hovered, setHovered] = useState(false), [focused, setFocused] = useState(false), [pinned, setPinned] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const visible = hovered || focused || pinned;
  useEffect(() => {
    if (!visible) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && (anchor.current?.contains(target) || tooltip.current?.contains(target))) return;
      setPinned(false); setHovered(false); setFocused(false);
    };
    const closeEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") { setPinned(false); setHovered(false); setFocused(false); }
    };
    document.addEventListener("pointerdown", closeOutside, true);
    window.addEventListener("keydown", closeEscape, true);
    return () => { document.removeEventListener("pointerdown", closeOutside, true); window.removeEventListener("keydown", closeEscape, true); };
  }, [visible]);
  useLayoutEffect(() => {
    if (!visible) return;
    const update = () => {
      if (!anchor.current || !tooltip.current) return;
      const a = anchor.current.getBoundingClientRect(), box = tooltip.current.getBoundingClientRect(), padding = 8, gap = 6;
      const left = Math.min(Math.max(padding, window.innerWidth - padding - box.width), Math.max(padding, a.left + a.width / 2 - box.width / 2));
      const above = a.top - gap - padding, below = window.innerHeight - a.bottom - gap - padding;
      const top = Math.min(Math.max(padding, window.innerHeight - padding - box.height),
        Math.max(padding, below >= box.height || below >= above ? a.bottom + gap : a.top - gap - box.height));
      setPosition(current => current?.left === left && current.top === top ? current : { left, top });
    };
    update(); window.addEventListener("resize", update); window.addEventListener("scroll", update, true);
    return () => { window.removeEventListener("resize", update); window.removeEventListener("scroll", update, true); };
  }, [visible, text]);
  return <>
    {children({ ref: anchor, "aria-describedby": visible ? id : undefined, "aria-expanded": visible,
      onMouseEnter: () => setHovered(true), onMouseLeave: () => setHovered(false),
      onFocus: () => setFocused(true), onBlur: () => setFocused(false),
      onClick: event => { event.stopPropagation(); setPinned(current => !current); },
      onKeyDown: event => {
        if (event.currentTarget.tagName !== "BUTTON" && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault(); setPinned(current => !current);
        }
      } })}
    {visible ? createPortal(<div ref={tooltip} role="tooltip" id={id} className={`${styles.tooltip} ${className ?? ""}`} {...dataAttributes}
      style={{ left: position?.left ?? 0, top: position?.top ?? 0, visibility: position ? "visible" : "hidden" }}>{text}</div>, document.body) : null}
  </>;
}
