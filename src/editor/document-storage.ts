import type { WorldDocument } from "@/domain/entity/world-document";

import { createDummyWorldDocument } from "./dummy-document";

export async function readWorldDocumentFromIndexedDb(
  documentId: string | null,
): Promise<WorldDocument> {
  void documentId;

  return createDummyWorldDocument();
}