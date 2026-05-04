import * as vscode from "vscode";
import { createAdapter } from "../adapter/createAdapter";
import { resolveKiwiConfig } from "../config/resolveConfig";
import { caseDocumentUri } from "./KiwiPlansTreeDataProvider";
import {
  buildCaseSearchMatchesFromResults,
  filterCaseSearchMatches,
  parseCaseSearchQuery
} from "./buildCaseSearchQuickPickItems";
import { CaseFilterController } from "./caseFilterController";
import { humanMessage } from "./extensionRuntimeSupport";
import {
  buildVisibleCaseSearchItems,
  pickCaseSearchItem,
  serializeCaseSearchItems
} from "./quickPickHelpers";
import { localize } from "./l10n";

type ClientFactory = () => Promise<{
  adapter: ReturnType<typeof createAdapter>;
  config: Awaited<ReturnType<typeof resolveKiwiConfig>>;
}>;

export function registerCaseSearchCommands(args: {
  clientFactory: ClientFactory;
  caseFilterController: CaseFilterController;
}): vscode.Disposable[] {
  const { clientFactory, caseFilterController } = args;

  return [
    vscode.commands.registerCommand(
      "kiwi.searchCases",
      async (injectedQuery?: unknown, injectedSelectionCaseId?: number) => {
        try {
          const providedQuery = typeof injectedQuery === "string" ? injectedQuery : undefined;
          if (
            providedQuery === undefined &&
            injectedSelectionCaseId !== undefined &&
            typeof injectedQuery !== "undefined"
          ) {
            return undefined;
          }
          const query =
            providedQuery ??
            (await vscode.window.showInputBox({
              prompt: localize("Enter a test case ID or summary."),
              placeHolder: localize("Example: 501 / Login")
            }));
          if (query === undefined) {
            return undefined;
          }

          const matches = await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: localize("Searching test cases...")
            },
            async () => {
              const { adapter, config } = await clientFactory();
              const parsedQuery = parseCaseSearchQuery(query);
              if (!parsedQuery.query) {
                return [];
              }
              const plans = (await adapter.listPlans(config)).sort((left, right) => left.id - right.id);
              const planCases = await Promise.all(
                plans.map(async (plan) => ({
                  plan,
                  cases: (await adapter.listPlanCases(config, plan.id)).sort((left, right) => left.id - right.id)
                }))
              );
              if (parsedQuery.mode === "body") {
                return buildCaseSearchMatchesFromResults(
                  planCases,
                  await adapter.searchCases(config, parsedQuery)
                );
              }
              return filterCaseSearchMatches(planCases, parsedQuery.query);
            }
          );

          if (matches.length === 0) {
            void vscode.window.showInformationMessage(localize("No matching test cases."));
            return [];
          }

          let visibleCount = 50;
          let items = buildVisibleCaseSearchItems(matches, visibleCount);
          let picked =
            injectedSelectionCaseId !== undefined
              ? items.find((item) => item.itemType === "case" && item.caseRef.id === injectedSelectionCaseId)
              : await pickCaseSearchItem(items);
          while (!injectedSelectionCaseId && picked?.itemType === "more") {
            visibleCount += 50;
            items = buildVisibleCaseSearchItems(matches, visibleCount);
            picked = await pickCaseSearchItem(items);
          }
          if (!picked) {
            return serializeCaseSearchItems(items);
          }
          if (picked.itemType === "more") {
            return serializeCaseSearchItems(items);
          }

          const uri = caseDocumentUri(picked.plan, picked.caseRef);
          await vscode.commands.executeCommand("vscode.open", uri);
          return {
            items: serializeCaseSearchItems(items),
            opened: uri.toString()
          };
        } catch (error) {
          void vscode.window.showErrorMessage(humanMessage(error));
          return undefined;
        }
      }
    ),
    vscode.commands.registerCommand("kiwi.filterCases", async () => {
      try {
        const panel = await caseFilterController.open();
        return panel.title;
      } catch (error) {
        void vscode.window.showErrorMessage(humanMessage(error));
        return undefined;
      }
    })
  ];
}
