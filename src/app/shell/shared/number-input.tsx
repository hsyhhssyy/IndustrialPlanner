import { useCallback, useRef, useState } from "react";

interface NumberInputProps {
  value: number | string;
  onRawChange?: (raw: string) => void;
  onCommit?: (value: number) => void;
  min?: number;
  max?: number;
  emptyFallback?: number;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** data-* 等属性透传 */
  [dataAttr: string]: unknown;
}

function parseNumber(
  raw: string,
  min?: number,
  max?: number,
  emptyFallback?: number,
): number {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return emptyFallback ?? min ?? 0;
  }

  const value = Number(trimmed);
  if (!Number.isFinite(value)) {
    return emptyFallback ?? min ?? 0;
  }

  let clamped = value;
  if (min !== undefined && Number.isFinite(min)) {
    clamped = Math.max(min, clamped);
  }
  if (max !== undefined && Number.isFinite(max)) {
    clamped = Math.min(max, clamped);
  }

  return clamped;
}

function toString(value: number | string): string {
  return typeof value === "string" ? value : String(value);
}

export function NumberInput({
  value,
  onRawChange,
  onCommit,
  min,
  max,
  emptyFallback,
  placeholder,
  disabled,
  className,
  ...rest
}: NumberInputProps) {
  const [draft, setDraft] = useState(() => toString(value));
  const [focused, setFocused] = useState(false);
  const [originalValue, setOriginalValue] = useState(draft);
  const [prevValue, setPrevValue] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  // 外部 value 变化时同步到草稿（仅在未聚焦时）。
  if (prevValue !== value) {
    setPrevValue(value);
    if (!focused) {
      const next = toString(value);
      setDraft(next);
      setOriginalValue(next);
    }
  }

  const commit = useCallback(() => {
    const parsed = parseNumber(draft, min, max, emptyFallback);
    const display = String(parsed);
    setDraft(display);
    setOriginalValue(display);
    onCommit?.(parsed);
  }, [draft, min, max, emptyFallback, onCommit]);

  const handleFocus = useCallback(() => {
    setFocused(true);
    setOriginalValue(draft);
  }, [draft]);

  const handleBlur = useCallback(() => {
    setFocused(false);
    commit();
  }, [commit]);

  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const raw = event.currentTarget.value;
      setDraft(raw);
      onRawChange?.(raw);
    },
    [onRawChange],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();
        commit();
        inputRef.current?.blur();
      }

      if (event.key === "Escape") {
        event.preventDefault();
        setDraft(originalValue);
        onRawChange?.(originalValue);
        inputRef.current?.blur();
      }
    },
    [commit, onRawChange, originalValue],
  );

  return (
    <input
      ref={inputRef}
      className={className}
      disabled={disabled}
      inputMode="decimal"
      placeholder={placeholder}
      type="text"
      value={draft}
      onBlur={handleBlur}
      onChange={handleChange}
      onFocus={handleFocus}
      onKeyDown={handleKeyDown}
      {...rest}
    />
  );
}
