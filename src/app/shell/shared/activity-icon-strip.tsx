import {
  resolveActivityDefinitionsByIds,
  type ActivityDefinition,
} from "@/shared/registry/activity-availability";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";

export function ActivityIconStrip({
  activityIds,
  activities,
  className = "",
}: {
  readonly activityIds: readonly string[];
  readonly activities?: readonly ActivityDefinition[];
  readonly className?: string;
}) {
  const definitions = resolveActivityDefinitionsByIds(activityIds, activities);

  if (definitions.length === 0) {
    return null;
  }

  return (
    <span className={cm(styles, ["activity-icon-strip", className].filter(Boolean).join(" "))}>
      {definitions.map((activity) => (
        <img
          alt={activity.name}
          className={cm(styles, "activity-icon-strip-icon")}
          key={activity.id}
          src={activity.icon}
          title={activity.name}
        />
      ))}
    </span>
  );
}
