export interface EditorBaseDocumentSummary {
  readonly baseId: string;
  readonly documentKey: string | null;
  readonly entityCount: number;
  readonly updatedAt: string | null;
}
