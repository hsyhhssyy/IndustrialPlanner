import { WorkspaceContract } from "@/domain/contract/workspace-contract";
import { AppContract } from "@/domain/contract/app-contract";
import { lookupMessageText } from "@/shared/i18n/messages";
import { lookupWorkbenchText } from "@/shared/i18n/workbench-placeholders";
import { createUiStateReadWrite, UiStateReadWrite } from "./state-impl";

export interface AppHost extends AppContract {
  workspace: WorkspaceContract;
  internalState: UiStateReadWrite;
  dispose: () => void;
}


export function createAppHost(
  workspace: WorkspaceContract
): AppHost {
  const internalState = createUiStateReadWrite();
  const actions: AppContract["actions"] = {
    translate: (key) => {
      const locale = internalState.settings.locale;

      return (
        lookupMessageText(locale, key) ??
        lookupWorkbenchText(locale, key) ??
        key
      );
    },
  };

  const host: AppHost = {
    state: internalState,
    workspace,
    internalState,
    dispose: () => {
    },
    queries: {},
    actions,
  };

  workspace.app = host;

  return host;
}
