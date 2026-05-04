import * as vscode from "vscode";
import { createAdapter } from "../adapter/createAdapter";
import { resolveKiwiConfig } from "../config/resolveConfig";
import { KiwiPlansTreeNode } from "./KiwiPlansTreeDataProvider";
import { PlanInfoDocumentProvider } from "./documentProviders";
import { planInfoUri } from "./extensionUris";
import { renderPlanInfoDocument } from "./renderPlanInfoDocument";
import {
  resolveCaseBrowserTarget,
  resolvePlanBrowserTarget,
  resolvePlanInfoTarget
} from "./commandTargetResolvers";

type ClientFactory = () => Promise<{
  adapter: ReturnType<typeof createAdapter>;
  config: Awaited<ReturnType<typeof resolveKiwiConfig>>;
}>;

export function registerPlanNavigationCommands(args: {
  clientFactory: ClientFactory;
  planInfoProvider: PlanInfoDocumentProvider;
}): vscode.Disposable[] {
  const { clientFactory, planInfoProvider } = args;

  return [
    vscode.commands.registerCommand("kiwi.showPlanInfo", async (target?: KiwiPlansTreeNode) => {
      const resolved = await resolvePlanInfoTarget(target, clientFactory);
      if (!resolved) {
        return;
      }

      const uri = planInfoUri(resolved.plan);
      planInfoProvider.setContent(
        uri,
        renderPlanInfoDocument({
          plan: resolved.planData
        })
      );
      await vscode.commands.executeCommand("vscode.open", uri);
      return uri.toString();
    }),
    vscode.commands.registerCommand("kiwi.openInBrowser", async (target?: KiwiPlansTreeNode) => {
      const resolved = await resolveCaseBrowserTarget(target, clientFactory);
      if (!resolved) {
        return;
      }

      await vscode.env.openExternal(resolved.uri);
      return resolved.uri.toString();
    }),
    vscode.commands.registerCommand("kiwi.openPlanInBrowser", async (target?: KiwiPlansTreeNode) => {
      const resolved = await resolvePlanBrowserTarget(target, clientFactory);
      if (!resolved) {
        return;
      }

      await vscode.env.openExternal(resolved.uri);
      return resolved.uri.toString();
    })
  ];
}
