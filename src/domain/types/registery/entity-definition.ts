import type { ConfigField } from "./config-field";

export interface EntityDefinition {
  id: string;
  nameKey: string;
  name: string;
  category:
    | "storage"
    | "bus"
    | "logistics"
    | "processor"
    | "track"
    | "dark-pipe";
  footprint: {
    width: number;
    height: number;
  };
  capabilityIds: string[];
  configFields: ConfigField[];
}