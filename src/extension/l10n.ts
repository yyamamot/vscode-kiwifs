import * as vscode from "vscode";

export interface LocalizedCommandLabels {
  kiwiApply: string;
  takeRemote: string;
}

export function localize(message: string, ...args: Array<string | number | boolean>): string {
  return vscode.l10n.t(message, ...args);
}

export function localizedCommandLabels(): LocalizedCommandLabels {
  return {
    kiwiApply: localize("Apply to Kiwi"),
    takeRemote: localize("Take Remote Changes")
  };
}
