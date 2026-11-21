import { useId } from "react";
import { InteractiveTooltip } from "./shared";
import styles from "./blueprint-planner-dialog.module.scss";

export function BlueprintPlannerChoice<T extends string>({ label, ariaLabel = label, hideLabel = false, value, choices, disabled, disabledReason, invalid, onChange }: {
  readonly label: string;
  readonly ariaLabel?: string;
  readonly hideLabel?: boolean;
  readonly value: T | undefined;
  readonly choices: readonly { readonly value: T; readonly label: string; readonly disabled?: boolean; readonly disabledReason?: string }[];
  readonly disabled?: boolean;
  readonly disabledReason?: string;
  readonly invalid?: boolean;
  readonly onChange: (value: T) => void;
}) {
  const name = useId();
  return <div className={styles.supplyControl}>
    {hideLabel ? null : <span>{label}</span>}
    <div className={styles.policyChoices} role="radiogroup" aria-label={ariaLabel} aria-invalid={invalid}>
      {choices.map(choice => {
        const unavailable = disabled || choice.disabled, reason = disabled ? disabledReason ?? choice.disabledReason : choice.disabledReason;
        const input = <><input type="radio" name={name} value={choice.value} checked={value === choice.value} disabled={unavailable}
          onChange={() => onChange(choice.value)} /><span>{choice.label}</span></>;
        return unavailable && reason ? <InteractiveTooltip<HTMLLabelElement> key={choice.value} text={reason}>
          {trigger => <label {...trigger} className={`${styles.policyChoice} ${styles.disabledPolicyChoice}`} tabIndex={0}
            role="button" aria-disabled="true" aria-label={`${choice.label}：${reason}`}>{input}</label>}
        </InteractiveTooltip> : <label className={styles.policyChoice} key={choice.value}>{input}</label>;
      })}
    </div>
  </div>;
}
