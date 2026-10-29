import { useRef, useState } from "react";
import Pencil from "~icons/lucide/pencil";
import Check from "~icons/lucide/check";
import X from "~icons/lucide/x";
import { MAX_PLANNER_TASK_TITLE_LENGTH } from "@/shared/planner-task";
import styles from "./blueprint-planner-dialog.module.scss";

export function BlueprintPlannerTaskTitle({ title, disabled, onSave, t }: {
  title: string; disabled: boolean; onSave: (value: string) => Promise<void>; t: (key: string) => string;
}) {
  const [editing, setEditing] = useState(false), [draft, setDraft] = useState(title);
  const [saving, setSaving] = useState(false), [error, setError] = useState<string | null>(null);
  const committing = useRef(false), cancelled = useRef(false);
  const cancel = () => { cancelled.current = true; setEditing(false); setError(null); };
  const save = async () => {
    if (cancelled.current || committing.current) return;
    committing.current = true; setSaving(true); setError(null);
    try { await onSave(draft); setEditing(false); }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { committing.current = false; setSaving(false); }
  };
  return <div className={styles.taskTitle}>
    <div className={styles.heading}>
      {editing ? <>
        <input autoFocus aria-label={t("eda.taskTitle")} value={draft} maxLength={MAX_PLANNER_TASK_TITLE_LENGTH} disabled={saving}
          onChange={event => setDraft(event.currentTarget.value)}
          onBlur={event => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.parentElement?.contains(event.relatedTarget)) void save(); }}
          onKeyDown={event => {
            if (event.nativeEvent.isComposing) { event.stopPropagation(); return; }
            if (event.key === "Enter") { event.preventDefault(); void save(); }
            if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cancel(); }
          }} />
        <button type="button" className={styles.titleAction} aria-label={t("action.confirm")} disabled={saving} onClick={() => void save()}><Check /></button>
        <button type="button" className={styles.titleAction} aria-label={t("action.cancel")} disabled={saving} onClick={cancel}><X /></button>
      </> : <>
        <h2 className={styles.target}>{title}</h2>
        <button type="button" className={styles.titleAction} aria-label={t("eda.editTaskTitle")} disabled={disabled}
          onClick={() => { cancelled.current = false; setDraft(title); setEditing(true); }}><Pencil /></button>
      </>}
    </div>
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}
  </div>;
}
