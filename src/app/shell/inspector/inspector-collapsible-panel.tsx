import { useId, useState, type AriaRole, type HTMLAttributes, type ReactNode } from "react";

import LucideChevronDown from "~icons/lucide/chevron-down";

import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";

interface InspectorCollapsiblePanelProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  title: string;
  dataInspectorKey: string;
  children: ReactNode;
  bodyClassName?: string;
  bodyRole?: AriaRole;
  defaultExpanded?: boolean;
  headerActions?: ReactNode;
  titleClassName?: string;
}

export function InspectorCollapsiblePanel({
  title,
  dataInspectorKey,
  bodyClassName,
  bodyRole,
  children,
  className,
  defaultExpanded = true,
  headerActions,
  titleClassName,
  ...articleProps
}: InspectorCollapsiblePanelProps) {
  const bodyId = useId();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const actionLabel = `${expanded ? "收起" : "展开"}${title}`;

  return (
    <article
      {...articleProps}
      className={cm(styles, "definition-card inspector-expanded-panel", className)}
      data-inspector-key={dataInspectorKey}
    >
      <div className={cm(styles, "inspector-expanded-header inspector-collapsible-header")}>
        <button
          aria-controls={bodyId}
          aria-expanded={expanded}
          aria-label={actionLabel}
          className={cm(styles, "inspector-expanded-header-toggle", titleClassName)}
          onClick={() => setExpanded((current) => !current)}
          type="button"
        >
          <LucideChevronDown
            aria-hidden="true"
            className={cm(styles, expanded ? "is-expanded" : "")}
          />
          <span>{title}</span>
        </button>
        {headerActions === undefined ? null : (
          <div className={cm(styles, "inspector-expanded-header-actions")}>
            {headerActions}
          </div>
        )}
      </div>
      {expanded ? (
        <div
          className={cm(styles, "inspector-expanded-body", bodyClassName)}
          id={bodyId}
          role={bodyRole}
        >
          {children}
        </div>
      ) : null}
    </article>
  );
}
