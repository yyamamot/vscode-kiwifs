import * as vscode from "vscode";
import { createAdapter } from "../adapter/createAdapter";
import { resolveKiwiConfig } from "../config/resolveConfig";
import { KiwiFileSystemProvider } from "../provider/KiwiFileSystemProvider";
import {
  findCaseHistoryDiffPair
} from "./buildCaseHistoryQuickPickItems";
import {
  caseInfoUri,
  KiwiPlansTreeDataProvider,
  type KiwiPlansTreeNode
} from "./KiwiPlansTreeDataProvider";
import { CaseFreshnessService, type CaseFreshnessResult } from "./caseFreshnessService";
import {
  CaseDiffDocumentProvider,
  CaseHistoryDocumentProvider,
  CaseInfoDocumentProvider
} from "./documentProviders";
import {
  activeCaseNode,
  caseDiffUri,
  caseHistoryUri,
  isCaseDocumentUri
} from "./extensionUris";
import { humanMessage } from "./extensionRuntimeSupport";
import {
  renderCaseDiffDocument,
  renderCaseDiffTitle
} from "./renderCaseDiffDocument";
import { renderCaseHistoryDocument } from "./renderCaseHistoryDocument";
import { renderCaseInfoDocument } from "./renderCaseInfoDocument";
import {
  resolveCaseDiffTarget,
  resolveCaseInfoTarget,
  resolveFreshnessUri
} from "./commandTargetResolvers";
import { pickCaseHistoryDiffPair } from "./quickPickHelpers";
import { createRequestId } from "./randomIds";

type ClientFactory = () => Promise<{
  adapter: ReturnType<typeof createAdapter>;
  config: Awaited<ReturnType<typeof resolveKiwiConfig>>;
}>;

export function registerCaseDocumentCommands(args: {
  provider: KiwiFileSystemProvider;
  treeDataProvider: KiwiPlansTreeDataProvider;
  clientFactory: ClientFactory;
  caseFreshnessService: CaseFreshnessService;
  caseDiffProvider: CaseDiffDocumentProvider;
  caseHistoryProvider: CaseHistoryDocumentProvider;
  caseInfoProvider: CaseInfoDocumentProvider;
}): vscode.Disposable[] {
  const {
    provider,
    treeDataProvider,
    clientFactory,
    caseFreshnessService,
    caseDiffProvider,
    caseHistoryProvider,
    caseInfoProvider
  } = args;

  return [
    vscode.commands.registerCommand("kiwi.refreshCaseDocument", async () => {
      const editor = vscode.window.activeTextEditor;
      const uri = editor?.document.uri;
      if (!editor || !uri || !isCaseDocumentUri(uri)) {
        void vscode.window.showInformationMessage(
          "Open a Kiwi case document before refreshing."
        );
        return false;
      }
      if (editor.document.isDirty) {
        void vscode.window.showErrorMessage(
          "Unsaved changes are present. Save or revert the document before refreshing."
        );
        return false;
      }

      try {
        await provider.refreshCaseDocument(uri);
        await vscode.commands.executeCommand("workbench.action.files.revert");
        return true;
      } catch (error) {
        void vscode.window.showErrorMessage(humanMessage(error));
        return false;
      }
    }),
    vscode.commands.registerCommand("kiwi.checkCaseFreshness", async (target?: KiwiPlansTreeNode) => {
      return checkCaseFreshness({
        target,
        provider,
        treeDataProvider,
        service: caseFreshnessService,
        showActions: true
      });
    }),
    vscode.commands.registerCommand("kiwi.showCaseDiff", async (target?: KiwiPlansTreeNode) => {
      const resolved = await resolveCaseDiffTarget(target, provider, clientFactory);
      if (!resolved) {
        return;
      }

      const title = renderCaseDiffTitle(resolved.caseData.summary);
      const requestId = createRequestId();
      const localUri = caseDiffUri("local", resolved.plan, resolved.caseRef, requestId);
      const remoteUri = caseDiffUri("remote", resolved.plan, resolved.caseRef, requestId);
      caseDiffProvider.setContent(localUri, renderCaseDiffDocument({ body: resolved.localBody }));
      caseDiffProvider.setContent(remoteUri, renderCaseDiffDocument({ body: resolved.remoteBody }));
      await vscode.commands.executeCommand("vscode.diff", localUri, remoteUri, title, {
        preview: false
      });
      return {
        localUri: localUri.toString(),
        remoteUri: remoteUri.toString(),
        title
      };
    }),
    vscode.commands.registerCommand("kiwi.showCaseHistoryDiff", async (target?: KiwiPlansTreeNode, historyId?: number) => {
      const resolvedTarget = target?.kind === "case" ? target : undefined;
      if (!resolvedTarget) {
        void vscode.window.showInformationMessage("Select a Kiwi case first.");
        return undefined;
      }

      try {
        const { adapter, config } = await clientFactory();
        const history = await adapter.getCaseHistory(config, resolvedTarget.caseRef.id);
        const selectedPair =
          historyId !== undefined
            ? findCaseHistoryDiffPair(history, historyId)
            : await pickCaseHistoryDiffPair(history);
        if (!selectedPair) {
          return undefined;
        }

        const [leftVersion, rightVersion] = await Promise.all([
          adapter.getCaseHistoryVersion(config, resolvedTarget.caseRef.id, selectedPair.left.historyId),
          selectedPair.right.kind === "history"
            ? adapter.getCaseHistoryVersion(config, resolvedTarget.caseRef.id, selectedPair.right.historyId)
            : adapter.getCaseBody(config, resolvedTarget.caseRef.id, resolvedTarget.plan.id)
        ]);
        const rightLabel =
          selectedPair.right.kind === "history" ? `History ${selectedPair.right.historyId}` : "Latest";
        const title = `${resolvedTarget.caseRef.summary} (History ${selectedPair.left.historyId} ↔ ${rightLabel})`;
        const requestId = createRequestId();
        const leftUri = caseDiffUri("history", resolvedTarget.plan, resolvedTarget.caseRef, requestId);
        const rightUri = caseDiffUri("latest", resolvedTarget.plan, resolvedTarget.caseRef, requestId);
        caseDiffProvider.setContent(leftUri, renderCaseDiffDocument({ body: leftVersion.text }));
        caseDiffProvider.setContent(rightUri, renderCaseDiffDocument({ body: rightVersion.text }));
        await vscode.commands.executeCommand("vscode.diff", leftUri, rightUri, title, {
          preview: false
        });
        return {
          historyUri: leftUri.toString(),
          latestUri: rightUri.toString(),
          title
        };
      } catch (error) {
        void vscode.window.showErrorMessage(humanMessage(error));
        return undefined;
      }
    }),
    vscode.commands.registerCommand("kiwi.showCaseHistory", async (target?: KiwiPlansTreeNode) => {
      const resolvedTarget = target?.kind === "case" ? target : undefined;
      if (!resolvedTarget) {
        void vscode.window.showInformationMessage("Select a Kiwi case first.");
        return undefined;
      }

      try {
        const { adapter, config } = await clientFactory();
        const history = await adapter.getCaseHistory(config, resolvedTarget.caseRef.id);
        const uri = caseHistoryUri(resolvedTarget.plan, resolvedTarget.caseRef);
        caseHistoryProvider.setContent(
          uri,
          renderCaseHistoryDocument({
            caseId: resolvedTarget.caseRef.id,
            summary: resolvedTarget.caseRef.summary,
            history
          })
        );
        await vscode.commands.executeCommand("vscode.open", uri);
        return uri.toString();
      } catch (error) {
        void vscode.window.showErrorMessage(humanMessage(error));
        return undefined;
      }
    }),
    vscode.commands.registerCommand("kiwi.showCaseInfo", async (target?: KiwiPlansTreeNode) => {
      const resolved = await resolveCaseInfoTarget(target, clientFactory);
      if (!resolved) {
        return;
      }

      const { plan, caseRef, caseData, versionToken } = resolved;
      const uri = caseInfoUri(plan, caseRef);
      caseInfoProvider.setContent(
        uri,
        renderCaseInfoDocument({
          caseData,
          versionToken
        })
      );
      await vscode.commands.executeCommand("vscode.open", uri);
      return uri.toString();
    })
  ];
}

export async function checkCaseFreshness(args: {
  target?: KiwiPlansTreeNode;
  provider: KiwiFileSystemProvider;
  treeDataProvider: KiwiPlansTreeDataProvider;
  service: CaseFreshnessService;
  showActions: boolean;
}): Promise<CaseFreshnessResult | undefined> {
  const resolvedTarget = args.target?.kind === "case" ? args.target : activeCaseNode();
  const uri = resolveFreshnessUri(args.target);
  if (!uri) {
    return undefined;
  }

  const result = await args.service.checkUri(uri);
  if (result.status === "fresh") {
    args.treeDataProvider.clearCaseFreshness(result.caseId);
    if (args.showActions) {
      void vscode.window.showInformationMessage("テストケースは最新です。");
    }
    return result;
  }

  if (result.status === "stale") {
    args.treeDataProvider.markCaseStale(
      result.caseId,
      "remote が更新されています。差分確認または明示更新してください。"
    );
    if (args.showActions) {
      const action = await vscode.window.showWarningMessage(
        "remote が更新されています。差分確認または明示更新してください。",
        "テストケースの差分を表示",
        "テストケースを更新"
      );
      if (action === "テストケースの差分を表示") {
        await vscode.commands.executeCommand("kiwi.showCaseDiff", resolvedTarget);
      } else if (action === "テストケースを更新") {
        if (vscode.window.activeTextEditor?.document.uri.toString() !== uri.toString()) {
          await vscode.commands.executeCommand("vscode.open", uri);
        }
        await vscode.commands.executeCommand("kiwi.refreshCaseDocument");
      }
    }
    return result;
  }

  if (args.showActions) {
    void vscode.window.showInformationMessage(
      result.reason ?? "最新状態を判定できませんでした。"
    );
  }
  return result;
}
