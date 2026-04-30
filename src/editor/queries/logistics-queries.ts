import type { EditorQuery } from "@/domain/query/editor-query";
import type { EditorQueriesContext } from "./types";
import {
  createEntityDefinitionMap,
  resolveLogisticsEndpointAtGridPoint,
} from "../logistics/logistics-utils";

type EditorLogisticsQueries = Pick<
  EditorQuery,
  | "canCreateLogisticsDraftStartHere"
  | "findLogisticsDraftEndpointAtGridPoint"
  | "resolveLogisticsDraftState"
>;

export function createEditorLogisticsQueries(
  context: EditorQueriesContext,
): EditorLogisticsQueries {
  const entityDefinitionMap = createEntityDefinitionMap(
    context.workspace.registry.entityDefinitions,
  );

  return {
    resolveLogisticsDraftState: () => {
      return context.state.internalTransientState.logisticsDraft;
    },
    findLogisticsDraftEndpointAtGridPoint: (gridPoint, kind) => {
      return resolveLogisticsEndpointAtGridPoint({
        gridPoint,
        kind,
        document: context.document.getSnapshot(),
        drafts: [],
        entityDefinitionMap,
      });
    },
    canCreateLogisticsDraftStartHere: (gridPoint, kind) => {
      return resolveLogisticsEndpointAtGridPoint({
        gridPoint,
        kind,
        document: context.document.getSnapshot(),
        drafts: [],
        entityDefinitionMap,
      }) !== null;
    },
  };
}
