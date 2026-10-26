import { useId } from "react";
import styles from "./blueprint-planner-dialog.module.scss";

export function BlueprintPlannerChoice<T extends string>({ label, ariaLabel = label, value, choices, disabled, invalid, onChange }: {
  readonly label: string;
  readonly ariaLabel?: string;
  readonly value: T;
  readonly choices: readonly { readonly value: T; readonly label: string }[];
  readonly disabled?: boolean;
  readonly invalid?: boolean;
  readonly onChange: (value: T) => void;
}) {
  const name = useId();
  return <div className={styles.supplyControl}>
    <span>{label}</span>
    <div className={styles.policyChoices} role="radiogroup" aria-label={ariaLabel} aria-invalid={invalid}>
      {choices.map(choice => <label className={styles.policyChoice} key={choice.value}>
        <input type="radio" name={name} value={choice.value} checked={value === choice.value} disabled={disabled}
          onChange={() => onChange(choice.value)} />
        <span>{choice.label}</span>
      </label>)}
    </div>
  </div>;
}
