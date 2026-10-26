import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

export async function mountTestComponent(element: ReactNode) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => { root.render(element); });
  return {
    container,
    async unmount() {
      await act(async () => { root.unmount(); });
      container.remove();
    },
  };
}

export function buttonWithText(container: ParentNode, text: string): HTMLButtonElement {
  const button = [...container.querySelectorAll("button")].find(element => element.textContent?.trim() === text);
  if (!button) throw new Error(`未找到按钮：${text}`);
  return button;
}

export function selectWithLabel(container: ParentNode, text: string): HTMLSelectElement {
  const field = [...container.querySelectorAll("select")].find(element =>
    element.getAttribute("aria-label") === text || element.closest("label")?.querySelector("span")?.textContent === text);
  if (!field) throw new Error(`未找到选择字段：${text}`);
  return field;
}

export function radioWithLabel(container: ParentNode, label: string, value?: string): HTMLInputElement {
  const group = [...container.querySelectorAll('[role="radiogroup"]')].find(element => element.getAttribute("aria-label") === label);
  const radio = [...group?.querySelectorAll<HTMLInputElement>('input[type="radio"]') ?? []]
    .find(input => value === undefined ? input.checked : input.value === value);
  if (!radio) throw new Error(`未找到单选字段：${label} · ${value ?? "当前选项"}`);
  return radio;
}

export async function clickTestElement(element: HTMLElement): Promise<void> {
  await act(async () => { element.click(); });
}

export async function changeTestValue(element: HTMLInputElement | HTMLSelectElement, value: string): Promise<void> {
  await act(async () => {
    if (element instanceof HTMLSelectElement) {
      element.value = value;
      element.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value);
      element.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
}

export async function settleTestDom(): Promise<void> {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
}
