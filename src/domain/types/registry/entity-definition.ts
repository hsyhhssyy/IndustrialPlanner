export interface EntityDefinition {
  id: string;
  nameKey: string;
  spiriteId: string;
  footprint: {
    width: number;
    height: number;
  };
  tags: string[];
}