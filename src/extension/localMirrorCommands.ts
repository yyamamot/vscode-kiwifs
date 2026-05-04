import * as vscode from "vscode";
import { createAdapter } from "../adapter/createAdapter";
import { resolveKiwiConfig } from "../config/resolveConfig";
import { KiwiError } from "../domain/errors";
import { KiwiFileSystemProvider } from "../provider/KiwiFileSystemProvider";
import { KiwiPlansTreeDataProvider, KiwiPlansTreeNode } from "./KiwiPlansTreeDataProvider";
import { CaseDiffDocumentProvider } from "./documentProviders";
import { localMirrorDiffUri, renderLocalMirrorDiffTitle } from "./extensionUris";
import { humanMessage } from "./extensionRuntimeSupport";
import {
  createLocalMirrorService,
  dedupeLocalMirrorScmResources,
  formatLocalMirrorScmSkippedSummary,
  refreshOpenedCaseDocumentAfterLocalMirrorUpload,
  resolveMirrorTarget,
  resolvePlanMirrorTarget,
  toUriLike
} from "./localMirrorCommandSupport";
import {
  LocalMirrorCompareResult,
  LocalMirrorScmComparableCase,
  toLocalMirrorScmResourceStatus
} from "./localMirrorService";
import {
  createKiwiLocalMirrorSourceControl,
  type LocalMirrorScmResource,
  type LocalMirrorScmSnapshotTarget,
  type UriLike
} from "./localMirrorSourceControl";
import { renderCaseDiffDocument } from "./renderCaseDiffDocument";
import { createRequestId } from "./randomIds";
import { localize } from "./l10n";

type ClientFactory = () => Promise<{
  adapter: ReturnType<typeof createAdapter>;
  config: Awaited<ReturnType<typeof resolveKiwiConfig>>;
}>;

type LocalMirrorSourceControl = ReturnType<typeof createKiwiLocalMirrorSourceControl>;
type LocalMirrorRemoteMetadataChecker = {
  checkCurrentMirrorMetadata(): Promise<boolean>;
};

export function registerLocalMirrorCommands(args: {
  context: vscode.ExtensionContext;
  clientFactory: ClientFactory;
  provider: KiwiFileSystemProvider;
  treeDataProvider: KiwiPlansTreeDataProvider;
  caseDiffProvider: CaseDiffDocumentProvider;
  localMirrorSourceControl: LocalMirrorSourceControl;
  localMirrorRemoteMetadataChecker: LocalMirrorRemoteMetadataChecker;
}): vscode.Disposable[] {
  const {
    context,
    clientFactory,
    provider,
    treeDataProvider,
    caseDiffProvider,
    localMirrorSourceControl,
    localMirrorRemoteMetadataChecker
  } = args;

  const buildLocalMirrorScmResources = (
    comparableCases: LocalMirrorScmComparableCase[]
  ): LocalMirrorScmResource[] => {
    const resources: LocalMirrorScmResource[] = [];
    for (const comparableCase of comparableCases) {
      const scmStatus = toLocalMirrorScmResourceStatus(comparableCase.compare.status);
      if (!scmStatus) {
        continue;
      }
      const requestId = createRequestId();
      const remoteUri = localMirrorDiffUri(
        "remote",
        comparableCase.plan,
        comparableCase.caseRef,
        requestId
      );
      caseDiffProvider.setContent(
        remoteUri,
        renderCaseDiffDocument({ body: comparableCase.compare.remoteBody })
      );
      resources.push({
        plan: comparableCase.plan,
        caseRef: comparableCase.caseRef,
        status: scmStatus,
        localPath: comparableCase.compare.localPath,
        localUri: toUriLike(vscode.Uri.file(comparableCase.compare.localPath)),
        remoteUri: toUriLike(remoteUri),
        diffTitle: renderLocalMirrorDiffTitle(comparableCase.caseRef.summary)
      });
    }
    return resources;
  };

  const applyLocalMirrorScmState = (
    target: LocalMirrorScmSnapshotTarget,
    comparableCases: LocalMirrorScmComparableCase[]
  ): LocalMirrorScmResource[] => {
    const resources = buildLocalMirrorScmResources(comparableCases);
    if (resources.length === 0) {
      localMirrorSourceControl.clear();
      treeDataProvider.clearCompareSnapshot();
      return [];
    }
    localMirrorSourceControl.setState({
      target,
      resources
    });
    treeDataProvider.setCompareSnapshot(
      resources.map((resource) => ({
        caseId: resource.caseRef.id,
        status: resource.status
      }))
    );
    return resources;
  };

  const clearLocalMirrorScmResource = (
    target: Extract<KiwiPlansTreeNode, { kind: "case" }>
  ) => {
    const state = localMirrorSourceControl.getState();
    if (!state) {
      return;
    }
    const resources = state.resources.filter(
      (resource) => resource.plan.id !== target.plan.id || resource.caseRef.id !== target.caseRef.id
    );
    if (resources.length === 0) {
      localMirrorSourceControl.clear();
      treeDataProvider.clearCompareSnapshot();
      return;
    }
    localMirrorSourceControl.setState({
      ...state,
      resources
    });
    treeDataProvider.setCompareSnapshot(
      resources.map((resource) => ({
        caseId: resource.caseRef.id,
        status: resource.status
      }))
    );
  };

  const refreshLocalMirrorScmSnapshot = async (
    target: LocalMirrorScmSnapshotTarget,
    announceErrors = false
  ) => {
    const service = createLocalMirrorService(clientFactory, context);
    if (!service) {
      localMirrorSourceControl.clear();
      treeDataProvider.clearCompareSnapshot();
      return undefined;
    }

    try {
      if (target.kind === "case") {
        const compare = await service.compareCase(target);
        return applyLocalMirrorScmState(target, [
          {
            plan: target.plan,
            caseRef: target.caseRef,
            compare
          }
        ]);
      }

      const snapshot = await service.getPlanMirrorSnapshot(target.plan);
      return applyLocalMirrorScmState(target, snapshot.comparableCases);
    } catch (error) {
      localMirrorSourceControl.clear();
      treeDataProvider.clearCompareSnapshot();
      if (announceErrors) {
        void vscode.window.showErrorMessage(humanMessage(error));
      }
      return undefined;
    }
  };

  const toChangesEditorUri = (uri: UriLike | vscode.Uri) =>
    uri instanceof vscode.Uri
      ? uri
      : uri.scheme === "file"
        ? vscode.Uri.file(uri.fsPath ?? uri.path)
        : vscode.Uri.parse(`${uri.scheme}:${uri.path}`);

  const buildComparableLocalMirrorDiffResource = (
    comparableCase: LocalMirrorScmComparableCase
  ) => {
    const requestId = createRequestId();
    const localUri = vscode.Uri.file(comparableCase.compare.localPath);
    const remoteUri = localMirrorDiffUri(
      "remote",
      comparableCase.plan,
      comparableCase.caseRef,
      requestId
    );
    const title = renderLocalMirrorDiffTitle(comparableCase.caseRef.summary);
    caseDiffProvider.setContent(
      remoteUri,
      renderCaseDiffDocument({ body: comparableCase.compare.remoteBody })
    );
    return {
      caseId: comparableCase.caseRef.id,
      status: comparableCase.compare.status,
      localUri: localUri.toString(),
      remoteUri: remoteUri.toString(),
      title,
      resource: [localUri, remoteUri, localUri] as const
    };
  };

  const buildPlanLocalMirrorChangesTitle = (plan: { name: string }) =>
    `Local Mirror Compare: ${plan.name}`;

  const openLocalMirrorDiff = async (
    target: Extract<KiwiPlansTreeNode, { kind: "case" }>,
    compare: LocalMirrorCompareResult
  ) => {
    const requestId = createRequestId();
    const localUri = vscode.Uri.file(compare.localPath);
    const remoteUri = localMirrorDiffUri(
      "remote",
      target.plan,
      target.caseRef,
      requestId
    );
    const title = renderLocalMirrorDiffTitle(target.caseRef.summary);
    caseDiffProvider.setContent(
      remoteUri,
      renderCaseDiffDocument({ body: compare.remoteBody })
    );
    await vscode.commands.executeCommand("vscode.diff", remoteUri, localUri, title, {
      preview: false
    });
    return {
      localUri: localUri.toString(),
      remoteUri: remoteUri.toString(),
      title,
      status: compare.status,
      localPath: compare.localPath
    };
  };

  const openPlanLocalMirrorChanges = async (
    target: Extract<KiwiPlansTreeNode, { kind: "plan" }>,
    comparableCases: LocalMirrorScmComparableCase[],
    options: { openEditor: boolean } = { openEditor: true }
  ) => {
    const openedDiffs = comparableCases.map(buildComparableLocalMirrorDiffResource);
    if (options.openEditor) {
      await vscode.commands.executeCommand(
        "vscode.changes",
        buildPlanLocalMirrorChangesTitle(target.plan),
        openedDiffs.map((entry) => entry.resource.map(toChangesEditorUri))
      );
    }
    return openedDiffs.map(({ resource: _, ...entry }) => entry);
  };

  return [
    vscode.commands.registerCommand(
      "kiwi.downloadPlanToLocalMirror",
      async (
        target?: KiwiPlansTreeNode,
        forceOverwrite?: boolean,
        skipConfirmation?: boolean
      ) => {
        const resolvedTarget = resolvePlanMirrorTarget(target);
        const service = createLocalMirrorService(clientFactory, context);
        if (!resolvedTarget || !service) {
          return undefined;
        }

        try {
          if (!forceOverwrite) {
            const rows = await service.getPlanMirrorStatus(resolvedTarget.plan);
            const requiresOverwrite = rows.some(
              (row) => row.status === "modified locally" || row.status === "conflict"
            );
            if (requiresOverwrite) {
              if (skipConfirmation === true) {
                forceOverwrite = false;
              } else {
                const confirmed =
                  (await vscode.window.showWarningMessage(
                    "配下のローカルミラーに未反映変更があります。Kiwi の最新本文でまとめて上書きしますか？",
                    { modal: true },
                    "上書きする"
                  )) === "上書きする";
                forceOverwrite = confirmed;
              }
            }
          }

          const result = await service.downloadPlanCases(resolvedTarget.plan, {
            force: forceOverwrite
          });
          void vscode.window.showInformationMessage(
            `Plan local mirror sync finished. downloaded=${result.downloaded}, overwritten=${result.overwritten}, skipped=${result.skipped}, failed=${result.failed}`
          );
          return result;
        } catch (error) {
          void vscode.window.showErrorMessage(humanMessage(error));
          return undefined;
        }
      }
    ),
    vscode.commands.registerCommand(
      "kiwi.comparePlanLocalMirror",
      async (
        target?: KiwiPlansTreeNode,
        options: { openEditor?: boolean } = {}
      ) => {
        const resolvedTarget = resolvePlanMirrorTarget(target);
        if (!resolvedTarget) {
          return undefined;
        }

        try {
          const service = createLocalMirrorService(clientFactory, context);
          if (!service) {
            localMirrorSourceControl.clear();
            treeDataProvider.clearCompareSnapshot();
            return undefined;
          }

          const snapshot = await service.getPlanMirrorSnapshot(resolvedTarget.plan);
          const resources = applyLocalMirrorScmState(
            {
              kind: "plan",
              plan: resolvedTarget.plan
            },
            snapshot.comparableCases
          );
          if (resources.length === 0) {
            void vscode.window.showInformationMessage(
              "No local mirror diffs were found for this plan."
            );
            localMirrorSourceControl.clear();
            treeDataProvider.clearCompareSnapshot();
            return {
              openedDiffs: []
            };
          }

          const skippedRows = snapshot.rows.filter(
            (row) => row.status === "missing locally" || row.status === "missing remote"
          );
          const openedDiffs = await openPlanLocalMirrorChanges(
            resolvedTarget,
            snapshot.comparableCases,
            { openEditor: options.openEditor !== false }
          );
          if (skippedRows.length > 0) {
            void vscode.window.showWarningMessage(
              `Some cases were excluded from diff because they are not comparable: ${skippedRows
                .map((row) => `${row.caseId}=${row.status}`)
                .join(", ")}`
            );
          }
          return {
            title: buildPlanLocalMirrorChangesTitle(resolvedTarget.plan),
            openedDiffs
          };
        } catch (error) {
          localMirrorSourceControl.clear();
          treeDataProvider.clearCompareSnapshot();
          void vscode.window.showErrorMessage(humanMessage(error));
          return undefined;
        }
      }
    ),
    vscode.commands.registerCommand(
      "kiwi.downloadCaseToLocalMirror",
      async (target?: KiwiPlansTreeNode, forceOverride?: boolean) => {
        const resolvedTarget = resolveMirrorTarget(target);
        const service = createLocalMirrorService(clientFactory, context);
        if (!resolvedTarget || !service) {
          return;
        }

        try {
          if (!forceOverride) {
            try {
              const result = await service.downloadCase(resolvedTarget);
              clearLocalMirrorScmResource(resolvedTarget);
              await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(result.localPath));
              void vscode.window.showInformationMessage("Case downloaded to local mirror.");
              return result;
            } catch (error) {
              if (
                error instanceof KiwiError &&
                (error.code === "ValidationFailed" || error.code === "ConflictDetected")
              ) {
                const confirmed =
                  (await vscode.window.showWarningMessage(
                    "ローカルミラーの未反映変更を破棄して、Kiwi の最新本文で上書きしますか？",
                    { modal: true },
                    "上書きする"
                  )) === "上書きする";
                if (!confirmed) {
                  return undefined;
                }
                forceOverride = true;
              } else {
                throw error;
              }
            }
          }

          const result = await service.downloadCase(resolvedTarget, { force: forceOverride });
          clearLocalMirrorScmResource(resolvedTarget);
          await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(result.localPath));
          void vscode.window.showInformationMessage("Case downloaded to local mirror.");
          return result;
        } catch (error) {
          void vscode.window.showErrorMessage(humanMessage(error));
          return undefined;
        }
      }),
    vscode.commands.registerCommand("kiwi.compareLocalMirror", async (target?: KiwiPlansTreeNode) => {
      const resolvedTarget = resolveMirrorTarget(target);
      const service = createLocalMirrorService(clientFactory, context);
      if (!resolvedTarget || !service) {
        return;
      }

      try {
        const result = await service.compareCase(resolvedTarget);
        const opened = await openLocalMirrorDiff(resolvedTarget, result);
        applyLocalMirrorScmState(resolvedTarget, [
          {
            plan: resolvedTarget.plan,
            caseRef: resolvedTarget.caseRef,
            compare: result
          }
        ]);
        void vscode.window.showInformationMessage(`Local mirror status: ${result.status}.`);
        return opened;
      } catch (error) {
        localMirrorSourceControl.clear();
        treeDataProvider.clearCompareSnapshot();
        void vscode.window.showErrorMessage(humanMessage(error));
        return undefined;
      }
    }),
    vscode.commands.registerCommand("kiwi.openLocalMirrorScmDiff", async (resource?: LocalMirrorScmResource) => {
      const service = createLocalMirrorService(clientFactory, context);
      if (!resource || !service) {
        return undefined;
      }

      const target: Extract<KiwiPlansTreeNode, { kind: "case" }> = {
        kind: "case",
        plan: resource.plan,
        caseRef: resource.caseRef
      };

      try {
        const compare = await service.compareCase(target);
        return openLocalMirrorDiff(target, compare);
      } catch (error) {
        void vscode.window.showErrorMessage(humanMessage(error));
        return undefined;
      }
    }),
    vscode.commands.registerCommand("kiwi.scmCompareLocalMirrorAgain", async (
      options: { openEditor?: boolean } = {}
    ) => {
      const state = localMirrorSourceControl.getState();
      if (!state) {
        void vscode.window.showInformationMessage("Run local mirror compare first.");
        return undefined;
      }

      return state.target.kind === "case"
        ? vscode.commands.executeCommand("kiwi.compareLocalMirror", state.target)
        : vscode.commands.executeCommand("kiwi.comparePlanLocalMirror", state.target, options);
    }),
    vscode.commands.registerCommand("kiwi.scmCheckRemoteLocalMirrorMetadata", async () => {
      const changed = await localMirrorRemoteMetadataChecker.checkCurrentMirrorMetadata();
      if (changed) {
        void vscode.window.showInformationMessage("Local mirror remote metadata check finished.");
      } else {
        void vscode.window.showInformationMessage("No local mirror remote metadata changes were found.");
      }
      return { changed };
    }),
    vscode.commands.registerCommand("kiwi.uploadLocalMirror", async (target?: KiwiPlansTreeNode) => {
      const resolvedTarget = resolveMirrorTarget(target);
      const service = createLocalMirrorService(clientFactory, context);
      if (!resolvedTarget || !service) {
        return;
      }

      try {
        const result = await service.uploadCase(resolvedTarget);
        const refreshResult = await refreshOpenedCaseDocumentAfterLocalMirrorUpload(
          provider,
          treeDataProvider,
          resolvedTarget
        );
        if (refreshResult === "refreshed") {
          void vscode.window.showInformationMessage(
            "Local mirror uploaded. Opened case document was refreshed."
          );
        } else if (refreshResult === "dirty") {
          void vscode.window.showInformationMessage(
            "Local mirror uploaded. Opened case document was not refreshed because it has unsaved changes."
          );
        } else {
          void vscode.window.showInformationMessage("Local mirror uploaded.");
        }
        return result;
      } catch (error) {
        void vscode.window.showErrorMessage(humanMessage(error));
        return undefined;
      }
    }),
    vscode.commands.registerCommand("kiwi.scmUploadLocalMirrorResources", async (...args: unknown[]) => {
      const service = createLocalMirrorService(clientFactory, context);
      const state = localMirrorSourceControl.getState();
      const requestedResources = dedupeLocalMirrorScmResources(
        localMirrorSourceControl.getResourcesFromCommandArgs(args) ??
          state?.resources.filter((resource) => resource.status === "LocalChanged") ??
          []
      );
      if (!service || !state) {
        return undefined;
      }

      const skippedResources = requestedResources.filter((resource) => resource.status !== "LocalChanged");
      const targetResources = requestedResources.filter((resource) => resource.status === "LocalChanged");

      if (targetResources.length === 0) {
        void vscode.window.showInformationMessage(
          skippedResources.length > 0
            ? formatLocalMirrorScmSkippedSummary(localize("Apply to Kiwi"), skippedResources.length)
            : "No local changes to upload."
        );
        return [];
      }

      let uploaded = 0;
      let refreshed = 0;
      let dirty = 0;
      let failed = 0;
      for (const resource of targetResources) {
        try {
          await service.uploadCase({
            plan: resource.plan,
            caseRef: resource.caseRef
          });
          const refreshResult = await refreshOpenedCaseDocumentAfterLocalMirrorUpload(
            provider,
            treeDataProvider,
            {
              kind: "case",
              plan: resource.plan,
              caseRef: resource.caseRef
            }
          );
          uploaded += 1;
          if (refreshResult === "refreshed") {
            refreshed += 1;
          } else if (refreshResult === "dirty") {
            dirty += 1;
          }
        } catch {
          failed += 1;
        }
      }

      await refreshLocalMirrorScmSnapshot(state.target);
      const summary = [
        `${localize("Apply to Kiwi")} finished. uploaded=${uploaded}, refreshed=${refreshed}, dirty=${dirty}, failed=${failed}`,
        skippedResources.length > 0
          ? formatLocalMirrorScmSkippedSummary(localize("Apply to Kiwi"), skippedResources.length)
          : undefined
      ].filter((line): line is string => Boolean(line)).join("\n");
      if (failed > 0 || skippedResources.length > 0) {
        void vscode.window.showWarningMessage(summary);
      } else {
        void vscode.window.showInformationMessage(summary);
      }
      return {
        uploaded,
        refreshed,
        dirty,
        failed,
        skipped: skippedResources.length
      };
    }),
    vscode.commands.registerCommand("kiwi.uploadPlanLocalMirror", async (target?: KiwiPlansTreeNode) => {
      const resolvedTarget = resolvePlanMirrorTarget(target);
      const service = createLocalMirrorService(clientFactory, context);
      if (!resolvedTarget || !service) {
        return undefined;
      }

      try {
        const result = await service.uploadPlanCases(resolvedTarget.plan);
        let refreshed = 0;
        let dirty = 0;
        for (const uploadedTarget of result.uploadedTargets) {
          const refreshResult = await refreshOpenedCaseDocumentAfterLocalMirrorUpload(
            provider,
            treeDataProvider,
            {
              kind: "case",
              plan: uploadedTarget.plan,
              caseRef: uploadedTarget.caseRef
            }
          );
          if (refreshResult === "refreshed") {
            refreshed += 1;
          } else if (refreshResult === "dirty") {
            dirty += 1;
          }
        }

        await refreshLocalMirrorScmSnapshot({
          kind: "plan",
          plan: resolvedTarget.plan
        });
        const summary = `Plan local mirror upload finished. uploaded=${result.uploaded}, refreshed=${refreshed}, dirty=${dirty}, skipped=${result.skipped}, failed=${result.failed}`;
        if (result.failed > 0 || result.skipped > 0 || dirty > 0) {
          void vscode.window.showWarningMessage(summary);
        } else {
          void vscode.window.showInformationMessage(summary);
        }
        return {
          uploaded: result.uploaded,
          refreshed,
          dirty,
          skipped: result.skipped,
          failed: result.failed
        };
      } catch (error) {
        void vscode.window.showErrorMessage(humanMessage(error));
        return undefined;
      }
    }),
    vscode.commands.registerCommand(
      "kiwi.scmTakeRemoteLocalMirrorResources",
      async (...args: unknown[]) => {
        const service = createLocalMirrorService(clientFactory, context);
        const state = localMirrorSourceControl.getState();
        const requestedResources = dedupeLocalMirrorScmResources(
          localMirrorSourceControl.getResourcesFromCommandArgs(args) ??
            state?.resources.filter((resource) => resource.status === "RemoteChanged") ??
            []
        );
        if (!service || !state) {
          return undefined;
        }

        const skippedResources = requestedResources.filter(
          (resource) => resource.status !== "RemoteChanged"
        );
        const targetResources = requestedResources.filter(
          (resource) => resource.status === "RemoteChanged"
        );

        if (targetResources.length === 0) {
          void vscode.window.showInformationMessage(
            skippedResources.length > 0
              ? formatLocalMirrorScmSkippedSummary(localize("Take Remote Changes"), skippedResources.length)
              : "No remote changes to take."
          );
          return [];
        }

        let taken = 0;
        let failed = 0;
        for (const resource of targetResources) {
          try {
            await service.takeRemoteChanges({
              plan: resource.plan,
              caseRef: resource.caseRef
            });
            taken += 1;
          } catch {
            failed += 1;
          }
        }

        await refreshLocalMirrorScmSnapshot(state.target);
        const summary = [
          `${localize("Take Remote Changes")} finished. taken=${taken}, failed=${failed}`,
          skippedResources.length > 0
            ? formatLocalMirrorScmSkippedSummary(localize("Take Remote Changes"), skippedResources.length)
            : undefined
        ].filter((line): line is string => Boolean(line)).join("\n");
        if (failed > 0 || skippedResources.length > 0) {
          void vscode.window.showWarningMessage(summary);
        } else {
          void vscode.window.showInformationMessage(summary);
        }
        return {
          taken,
          failed,
          skipped: skippedResources.length
        };
      }
    ),
    vscode.commands.registerCommand("kiwi.revealLocalMirror", async (target?: KiwiPlansTreeNode) => {
      const resolvedTarget = resolveMirrorTarget(target);
      const service = createLocalMirrorService(clientFactory, context);
      if (!resolvedTarget || !service) {
        return;
      }

      try {
        const localPath = await service.revealLocalMirror(resolvedTarget);
        await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(localPath));
        return localPath;
      } catch (error) {
        void vscode.window.showErrorMessage(humanMessage(error));
        return undefined;
      }
    })
  ];
}
