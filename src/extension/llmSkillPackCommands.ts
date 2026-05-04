import * as vscode from "vscode";
import { LocalMirrorScmResource, type LocalMirrorScmState, type UriLike } from "./localMirrorSourceControl";
import {
  createLlmLocalMirrorDiffContext
} from "./llmDiffContextService";
import {
  ensureLlmGitignoreEntries,
  formatGitignoreWarning,
  installLlmSkillPack,
  startLlmEditSession
} from "./llmSkillPackService";
import { localizedCommandLabels, localize } from "./l10n";

type LlmSkillPackCommandOptions = {
  updateGitignore?: boolean;
  taskText?: string;
};

export function registerLlmSkillPackCommands(args: {
  getLocalMirrorScmState?: () => LocalMirrorScmState | undefined;
} = {}): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand("kiwi.installLlmSkillPack", async (
      injectedWorkspaceRoot?: unknown,
      options?: LlmSkillPackCommandOptions
    ) => {
      const workspaceRoot = resolveWorkspaceRoot(injectedWorkspaceRoot);
      if (!workspaceRoot) {
        return undefined;
      }
      await ensureGitignoreWithUserChoice(workspaceRoot, options);
      const result = await installLlmSkillPack(workspaceRoot);
      void vscode.window.showInformationMessage(
        localize("LLM Local Mirror Skills installed. files={0}", result.files.length)
      );
      return result;
    }),
    vscode.commands.registerCommand("kiwi.startLlmEditSession", async (
      injectedWorkspaceRoot?: unknown,
      options?: LlmSkillPackCommandOptions
    ) => {
      const workspaceRoot = resolveWorkspaceRoot(injectedWorkspaceRoot);
      if (!workspaceRoot) {
        return undefined;
      }
      const gitignoreResult = await ensureGitignoreWithUserChoice(workspaceRoot, options);
      const result = await startLlmEditSession(workspaceRoot, {
        gitignoreWarning: formatGitignoreWarning(gitignoreResult),
        taskText: options?.taskText,
        uiLabels: localizedCommandLabels()
      });
      const suffix = result.editableFiles.length > 0
        ? localize("editable={0}", result.editableFiles.length)
        : localize("sync local mirror before editing");
      void vscode.window.showInformationMessage(localize("LLM Local Mirror Prompt prepared. {0}", suffix));
      return result;
    }),
    vscode.commands.registerCommand("kiwi.createLlmLocalMirrorDiffContext", async (injectedWorkspaceRoot?: unknown) => {
      const workspaceRoot = resolveWorkspaceRoot(injectedWorkspaceRoot);
      if (!workspaceRoot) {
        return undefined;
      }
      const state = args.getLocalMirrorScmState?.();
      if (!state) {
        void vscode.window.showErrorMessage(localize("Run Check Diff or Compare Again first."));
        return undefined;
      }
      const result = await createLlmLocalMirrorDiffContext(workspaceRoot, state, {
        readResourceText: readLocalMirrorDiffResourceText,
        uiLabels: localizedCommandLabels()
      });
      void vscode.window.showInformationMessage(
        localize("LLM Local Mirror Diff prepared. resources={0}", result.resourceCount)
      );
      return result;
    })
  ];
}

function resolveWorkspaceRoot(injectedWorkspaceRoot?: unknown): string | undefined {
  if (typeof injectedWorkspaceRoot === "string" && injectedWorkspaceRoot.length > 0) {
    return injectedWorkspaceRoot;
  }
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    void vscode.window.showInformationMessage(localize("Open a workspace folder before using LLM Skill Pack commands."));
    return undefined;
  }
  return workspaceRoot;
}

async function ensureGitignoreWithUserChoice(
  workspaceRoot: string,
  options?: LlmSkillPackCommandOptions
) {
  if (typeof options?.updateGitignore === "boolean") {
    return ensureLlmGitignoreEntries(workspaceRoot, options.updateGitignore);
  }

  const dryRun = await ensureLlmGitignoreEntries(workspaceRoot, false);
  if (dryRun.missingEntries.length === 0) {
    return dryRun;
  }

  const selected = await vscode.window.showWarningMessage(
    localize("Add {0} to .gitignore?", dryRun.missingEntries.join(", ")),
    localize("Add"),
    localize("Skip")
  );
  return ensureLlmGitignoreEntries(workspaceRoot, selected === localize("Add"));
}

async function readLocalMirrorDiffResourceText(
  resource: LocalMirrorScmResource,
  side: "local" | "remote"
): Promise<string> {
  const uri = side === "local"
    ? vscode.Uri.file(resource.localPath)
    : toVscodeUri(resource.remoteUri);
  const document = await vscode.workspace.openTextDocument(uri);
  return document.getText();
}

function toVscodeUri(uri: UriLike): vscode.Uri {
  return uri.scheme === "file"
    ? vscode.Uri.file(uri.fsPath ?? uri.path)
    : vscode.Uri.parse(`${uri.scheme}:${uri.path}`);
}
