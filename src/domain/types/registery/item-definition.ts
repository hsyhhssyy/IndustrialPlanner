import type { Medium } from "./medium";

export interface ItemDefinition {
  id: string;
  nameKey: string;
  name: string;
  medium: Medium;
  tags: string[];
}