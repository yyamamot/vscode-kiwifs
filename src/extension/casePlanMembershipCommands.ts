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
              prompt: "追加する既存テストケース ID または summary を入力してください",
              placeHolder: "例: 501 / Login"
            }));
          if (query === undefined) {
            return undefined;
          }

          const items = await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: "既存テストケースを検索中..."
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
                buildExistingCaseToPlanEntries(planCases, resolved.plan.id, query)
              );
            }
          );

          if (items.length === 0) {
            void vscode.window.showInformationMessage(
              "追加できる既存テストケースは見つかりませんでした。"
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
              "テストケースは既にこの計画に含まれています。"
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
            "テスト計画に既存テストケースを追加しました。"
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
          `この計画からテストケース ${args.target.caseRef.id} - ${args.target.caseRef.summary} を外しますか？`,
          { modal: true },
          "外す"
        )) === "外す");
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
      void vscode.window.showInformationMessage("テストケースをこの計画から外しました。");
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
            ? "テスト計画のテストケースを取得中..."
            : "この計画のテストケースを取得中..."
      },
      async () =>
        buildRemoveCaseFromPlanQuickPickItems(
          resolved.plan,
          await adapter.listPlanCases(config, resolved.plan.id)
        )
    );

    if (items.length === 0) {
      void vscode.window.showInformationMessage(
        args.source === "plan"
          ? "テスト計画に含まれるテストケースはありません。"
          : "この計画に含まれるテストケースはありません。"
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
          ? `テスト計画からテストケース ${picked.caseRef.id} - ${picked.caseRef.summary} を外しますか？`
          : `この計画からテストケース ${picked.caseRef.id} - ${picked.caseRef.summary} を外しますか？`,
        { modal: true },
        "外す"
      )) === "外す");
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
        ? "テスト計画からテストケースを外しました。"
        : "テストケースをこの計画から外しました。"
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
