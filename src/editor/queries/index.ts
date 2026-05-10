import type { EditorQuery } from "@/domain/editor/editor-query";

import { createEditorDocumentQueries } from "./document-queries";
import { createEditorEntityQueries } from "./entity-queries";
import { createEditorLogisticsQueries } from "./logistics-queries";
import type { EditorQueriesContext } from "./types";
import { createEditorViewportQueries } from "./viewport-queries";

export function createEditorQueries(
  context: EditorQueriesContext,
): EditorQuery {
  return {
    ...createEditorDocumentQueries(context),
    ...createEditorEntityQueries(context),
    ...createEditorLogisticsQueries(context),
    ...createEditorViewportQueries(context),
  };
}

export type { EditorQueriesContext } from "./types";
