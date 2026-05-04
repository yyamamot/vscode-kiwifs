import * as vscode from "vscode";
import { KiwiAdapter } from "../adapter/types";
import { KiwiConfig } from "../types";
import { KiwiFileSystemProvider } from "../provider/KiwiFileSystemProvider";
import { KiwiPlansTreeDataProvider, type KiwiPlansTreeNode } from "./KiwiPlansTreeDataProvider";
import {
  buildExistingCaseToPlanEntries,
  buildExistingCaseToPlanQuickPickItems
} from "./buildExistingCaseToPlanQuickPickItems";
import { buildRemoveCaseFromPlanQuickPickItems } from "./buildRemoveCaseFromPlanQuickPickItems";
import { resolveAddExistingCaseToPlanTarget } from "./commandTargetResolvers";
import {
  pickExistingCaseToPlanItem,
  pickRemoveCaseFromPlanItem,
  serializeExistingCaseToPlanItem,
  serializeRemoveCaseFromPlanItem
} from "./quickPickHelpers";
import { humanMessage } from "./extensionRuntimeSupport";
import { localize } from "./l10n";

type ClientFactory = () => Promise<{
  adapter: KiwiAdapter;
  config: KiwiConfig;
}>;

export function registerCasePlanMembershipCommands(args: {
  clientFactory: ClientFactory;
  provider: KiwiFileSystemProvider;
  treeDataProvider: KiwiPlansTreeDataProvider;
}): vscode.Disposable[] {
  const { clientFactory, provider, treeDataProvider } = args;

  return [
    vscode.commands.registerCommand(
      "kiwi.addExistingCaseToPlan",
      async (
        target?: KiwiPlansTreeNode,
        injectedQuery?: string,
        injectedSelectionCaseId?: number
      ) => {
        const resolved = resolveAddExistingCaseToPlanTarget(target);
        if (!resolved) {
          return undefined;
        }

        try {
          const query =
            injectedQuery ??
            (await vscode.window.showInputBox({
              prompt: localize("Enter an existing test case ID or summary to add."),
              placeHolder: localize("Example: 501 / Login")
            }));
          if (query === undefined) {
            return undefined;
          }

          const items = await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: localize("Searching existing test cases...")
            },
            async () => {
              const { adapter, config } = await clientFactory();
              const plans = (await adapter.listPlans(config)).sort((left, right) => left.id - right.id);
              const planCases = await Promise.all(
                plans.map(async (plan) => ({
                  plan,
                  cases: (await adapter.listPlanCases(config, plan.id)).sort((left, right) => left.id - right.id)
                }))
              );
              return buildExistingCaseToPlanQuickPickItems(
                buildExistingCaseToPlanEntries(planCases, resolved.plan.id, query),
                { detail: localize("Existing test case to add to this plan") }
              );
            }
          );

          if (items.length === 0) {
            void vscode.window.showInformationMessage(
              localize("No addable test cases were found.")
            );
            return [];
          }

          const picked =
            injectedSelectionCaseId !== undefined
              ? items.find((item) => item.entry.caseId === injectedSelectionCaseId)
              : await pickExistingCaseToPlanItem(items);
          if (!picked) {
            return items.map((item) => serializeExistingCaseToPlanItem(item));
          }

          const { adapter, config } = await clientFactory();
          const currentCases = await adapter.listPlanCases(config, resolved.plan.id);
          if (currentCases.some((caseRef) => caseRef.id === picked.entry.caseId)) {
            void vscode.window.showInformationMessage(
              localize("The test case is already included in this plan.")
            );
            return {
              planId: resolved.plan.id,
              caseId: picked.entry.caseId,
              summary: picked.entry.summary,
              alreadyExists: true
            };
          }

          await adapter.addCaseToPlan(config, resolved.plan.id, picked.entry.caseId);
          provider.refreshListings();
          treeDataProvider.refresh();
          void vscode.window.showInformationMessage(
            localize("Added the existing test case to the test plan.")
          );
          return {
            planId: resolved.plan.id,
            caseId: picked.entry.caseId,
            summary: picked.entry.summary
          };
        } catch (error) {
          void vscode.window.showErrorMessage(humanMessage(error));
          return undefined;
        }
      }
    ),
    vscode.commands.registerCommand(
      "kiwi.removeCaseFromPlan",
      async (
        target?: KiwiPlansTreeNode,
        injectedSelectionCaseId?: number,
        injectedConfirmation?: boolean
      ) => {
        return runRemoveCaseFromPlan({
          clientFactory,
          provider,
          treeDataProvider,
          target,
          injectedSelectionCaseId,
          injectedConfirmation,
          source: "case"
        });
      }
    ),
    vscode.commands.registerCommand(
      "kiwi.removeCaseFromPlanFromPlan",
      async (
        target?: KiwiPlansTreeNode,
        injectedSelectionCaseId?: number,
        injectedConfirmation?: boolean
      ) => {
        return runRemoveCaseFromPlan({
          clientFactory,
          provider,
          treeDataProvider,
          target,
          injectedSelectionCaseId,
          injectedConfirmation,
          source: "plan"
        });
      }
    )
  ];
}

export async function runRemoveCaseFromPlan(args: {
  clientFactory: ClientFactory;
  provider: KiwiFileSystemProvider;
  treeDataProvider: KiwiPlansTreeDataProvider;
  target?: KiwiPlansTreeNode;
  injectedSelectionCaseId?: number;
  injectedConfirmation?: boolean;
  source: "plan" | "case";
}) {
  try {
    const { adapter, config } = await args.clientFactory();
    if (args.target?.kind === "case") {
      const proceed =
          args.injectedConfirmation ??
        ((await vscode.window.showWarningMessage(
          localize("Remove test case {0} - {1} from this plan?", args.target.caseRef.id, args.target.caseRef.summary),
          { modal: true },
          localize("Remove")
        )) === localize("Remove"));
      if (!proceed) {
        return {
          planId: args.target.plan.id,
          caseId: args.target.caseRef.id,
          summary: args.target.caseRef.summary,
          cancelled: true
        };
      }

      await adapter.removeCaseFromPlan(config, args.target.plan.id, args.target.caseRef.id);
      args.provider.refreshListings();
      args.treeDataProvider.refresh();
      void vscode.window.showInformationMessage(localize("Removed the test case from this plan."));
      return {
        planId: args.target.plan.id,
        caseId: args.target.caseRef.id,
        summary: args.target.caseRef.summary
      };
    }

    const resolved = resolveAddExistingCaseToPlanTarget(args.target);
    if (!resolved) {
      return undefined;
    }

    const items = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title:
          args.source === "plan"
            ? localize("Loading test cases in the test plan...")
            : localize("Loading test cases in this plan...")
      },
      async () =>
        buildRemoveCaseFromPlanQuickPickItems(
          resolved.plan,
          await adapter.listPlanCases(config, resolved.plan.id),
          { detail: localize("Test case to remove from this plan") }
        )
    );

    if (items.length === 0) {
      void vscode.window.showInformationMessage(
        args.source === "plan"
          ? localize("The test plan does not include any test cases.")
          : localize("This plan does not include any test cases.")
      );
      return [];
    }

    const picked =
      args.injectedSelectionCaseId !== undefined
        ? items.find((item) => item.caseRef.id === args.injectedSelectionCaseId)
        : await pickRemoveCaseFromPlanItem(items);
    if (!picked) {
      return items.map((item) => serializeRemoveCaseFromPlanItem(item));
    }

    const proceed =
      args.injectedConfirmation ??
      ((await vscode.window.showWarningMessage(
        args.source === "plan"
          ? localize("Remove test case {0} - {1} from the test plan?", picked.caseRef.id, picked.caseRef.summary)
          : localize("Remove test case {0} - {1} from this plan?", picked.caseRef.id, picked.caseRef.summary),
        { modal: true },
        localize("Remove")
      )) === localize("Remove"));
    if (!proceed) {
      return {
        planId: resolved.plan.id,
        caseId: picked.caseRef.id,
        summary: picked.caseRef.summary,
        cancelled: true
      };
    }

    await adapter.removeCaseFromPlan(config, resolved.plan.id, picked.caseRef.id);
    args.provider.refreshListings();
    args.treeDataProvider.refresh();
    void vscode.window.showInformationMessage(
      args.source === "plan"
        ? localize("Removed the test case from the test plan.")
        : localize("Removed the test case from this plan.")
    );
    return {
      planId: resolved.plan.id,
      caseId: picked.caseRef.id,
      summary: picked.caseRef.summary
    };
  } catch (error) {
    void vscode.window.showErrorMessage(humanMessage(error));
    return undefined;
  }
}
