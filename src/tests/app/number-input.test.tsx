// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NumberInput } from "@/app/shell/shared/number-input";

function renderNumberInput(props: React.ComponentProps<typeof NumberInput>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<NumberInput {...props} />);
  });
  const input = container.querySelector("input");

  if (input === null) {
    throw new Error("NumberInput did not render an <input> element.");
  }

  return { container, root, input };
}

function fireChange(input: HTMLInputElement, raw: string) {
  act(() => {
    input.focus();
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;

    if (nativeInputValueSetter !== undefined) {
      nativeInputValueSetter.call(input, raw);
    }

    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function fireBlur(input: HTMLInputElement) {
  act(() => {
    input.blur();
  });
}

function fireEnter(input: HTMLInputElement) {
  act(() => {
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
}

function fireEscape(input: HTMLInputElement) {
  act(() => {
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
}

describe("NumberInput", () => {
  let container: HTMLDivElement;
  let root: Root | null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = null;
  });

  afterEach(() => {
    if (root !== null) {
      act(() => {
        root.unmount();
      });
    }
    container.remove();
  });

  describe("rendering", () => {
    it("renders as type=text with inputMode=decimal", () => {
      root = createRoot(container);
      act(() => {
        root.render(<NumberInput value={5} />);
      });
      const input = container.querySelector("input");
      expect(input?.type).toBe("text");
      expect(input?.getAttribute("inputmode")).toBe("decimal");
    });

    it("renders initial number value as string in the input", () => {
      root = createRoot(container);
      act(() => {
        root.render(<NumberInput value={42} />);
      });
      const input = container.querySelector("input");
      expect(input?.value).toBe("42");
    });

    it("accepts string value", () => {
      root = createRoot(container);
      act(() => {
        root.render(<NumberInput value="3.14" />);
      });
      const input = container.querySelector("input");
      expect(input?.value).toBe("3.14");
    });

    it("applies className", () => {
      root = createRoot(container);
      act(() => {
        root.render(<NumberInput value={0} className="my-input" />);
      });
      const input = container.querySelector("input");
      expect(input?.className).toContain("my-input");
    });

    it("forwards data-* attributes", () => {
      root = createRoot(container);
      act(() => {
        root.render(<NumberInput value={0} data-test-id="num-foo" />);
      });
      const input = container.querySelector("input");
      expect(input?.getAttribute("data-test-id")).toBe("num-foo");
    });

    it("respects disabled prop", () => {
      root = createRoot(container);
      act(() => {
        root.render(<NumberInput value={0} disabled />);
      });
      const input = container.querySelector("input");
      expect(input?.disabled).toBe(true);
    });

    it("respects placeholder", () => {
      root = createRoot(container);
      act(() => {
        root.render(<NumberInput value={0} placeholder="请输入" />);
      });
      const input = container.querySelector("input");
      expect(input?.placeholder).toBe("请输入");
    });
  });

  describe("onRawChange", () => {
    it("calls onRawChange with raw string on every input", () => {
      const onRawChange = vi.fn();
      const { input } = renderNumberInput({ value: 10, onRawChange });

      fireChange(input, "12");

      // onRawChange 在每次按键时触发
      expect(onRawChange).toHaveBeenCalledWith("12");
    });

    it("passes empty string when user clears input", () => {
      const onRawChange = vi.fn();
      const { input } = renderNumberInput({ value: 5, onRawChange });

      fireChange(input, "");

      expect(onRawChange).toHaveBeenCalledWith("");
    });

    it("does NOT call onCommit during typing (only on blur/Enter)", () => {
      const onCommit = vi.fn();
      const { input } = renderNumberInput({ value: 5, onCommit });

      fireChange(input, "99");

      expect(onCommit).not.toHaveBeenCalled();
    });
  });

  describe("onCommit on blur", () => {
    it("commits parsed number on blur", () => {
      const onCommit = vi.fn();
      const { input } = renderNumberInput({ value: 5, onCommit });

      fireChange(input, "42");
      fireBlur(input);

      expect(onCommit).toHaveBeenCalledWith(42);
      expect(input.value).toBe("42");
    });

    it("commits 0 when input is cleared (default emptyFallback)", () => {
      const onCommit = vi.fn();
      const { input } = renderNumberInput({ value: 5, onCommit });

      fireChange(input, "");
      fireBlur(input);

      expect(onCommit).toHaveBeenCalledWith(0);
      expect(input.value).toBe("0");
    });

    it("commits custom emptyFallback when input is cleared", () => {
      const onCommit = vi.fn();
      const { input } = renderNumberInput({
        value: 5,
        onCommit,
        emptyFallback: 99,
      });

      fireChange(input, "");
      fireBlur(input);

      expect(onCommit).toHaveBeenCalledWith(99);
      expect(input.value).toBe("99");
    });

    it("commits invalid text as fallback", () => {
      const onCommit = vi.fn();
      const { input } = renderNumberInput({ value: 5, onCommit });

      fireChange(input, "abc");
      fireBlur(input);

      expect(onCommit).toHaveBeenCalledWith(0);
    });

    it("clamps to min on commit", () => {
      const onCommit = vi.fn();
      const { input } = renderNumberInput({ value: 5, min: 10, onCommit });

      fireChange(input, "3");
      fireBlur(input);

      expect(onCommit).toHaveBeenCalledWith(10);
      expect(input.value).toBe("10");
    });

    it("clamps to max on commit", () => {
      const onCommit = vi.fn();
      const { input } = renderNumberInput({ value: 50, max: 100, onCommit });

      fireChange(input, "200");
      fireBlur(input);

      expect(onCommit).toHaveBeenCalledWith(100);
      expect(input.value).toBe("100");
    });

    it("does NOT clamp when value is within range", () => {
      const onCommit = vi.fn();
      const { input } = renderNumberInput({
        value: 5,
        min: 0,
        max: 100,
        onCommit,
      });

      fireChange(input, "50");
      fireBlur(input);

      expect(onCommit).toHaveBeenCalledWith(50);
    });

    it("does NOT call onCommit when prop is omitted", () => {
      const { input } = renderNumberInput({ value: 5 });

      fireChange(input, "42");
      fireBlur(input);

      // onCommit 是可选的，省略时失焦不应抛错
      expect(input.value).toBe("42");
    });
  });

  describe("Enter key", () => {
    it("triggers commit on Enter", () => {
      const onCommit = vi.fn();
      const { input } = renderNumberInput({ value: 5, onCommit });

      fireChange(input, "77");
      fireEnter(input);

      expect(onCommit).toHaveBeenCalledWith(77);
    });
  });

  describe("Escape key", () => {
    it("reverts to original value on Escape", () => {
      const onRawChange = vi.fn();
      const onCommit = vi.fn();
      const { input } = renderNumberInput({
        value: 10,
        onRawChange,
        onCommit,
      });

      // 模拟用户聚焦、修改、然后按 Escape
      act(() => {
        input.dispatchEvent(new FocusEvent("focus", { bubbles: true }));
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          "value",
        )?.set;
        if (setter !== undefined) {
          setter.call(input, "999");
        }
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      });

      // 应恢复为原始值
      expect(input.value).toBe("10");
      expect(onCommit).not.toHaveBeenCalled();
    });
  });

  describe("external value sync", () => {
    it("syncs when not focused", () => {
      const { root: r, input } = renderNumberInput({ value: 3 });

      act(() => {
        r.render(<NumberInput value={7} />);
      });

      expect(input.value).toBe("7");
    });

    it("does NOT sync when focused (prevents overwriting user input)", () => {
      const { root: r, input } = renderNumberInput({ value: 3 });

      act(() => {
        input.focus();
      });

      fireChange(input, "555");

      act(() => {
        r.render(<NumberInput value={7} />);
      });

      // 聚焦中，不应被外部 value 覆盖
      expect(input.value).toBe("555");
    });
  });

  describe("number parsing edge cases", () => {
    it("handles leading decimal (e.g. '.5' → 0.5)", () => {
      const onCommit = vi.fn();
      const { input } = renderNumberInput({ value: 3, onCommit });

      fireChange(input, ".5");
      fireBlur(input);

      expect(onCommit).toHaveBeenCalledWith(0.5);
    });

    it("handles negative sign alone as fallback", () => {
      const onCommit = vi.fn();
      const { input } = renderNumberInput({ value: 3, onCommit });

      fireChange(input, "-");
      fireBlur(input);

      // "-" 的 Number() 是 NaN，应回退
      expect(onCommit).toHaveBeenCalledWith(0);
    });
  });
});
