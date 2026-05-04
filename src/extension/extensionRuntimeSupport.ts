import * as vscode from "vscode";
import { KiwiError } from "../domain/errors";
import { JsonlLogger } from "../logging/jsonlLogger";

export function humanMessage(error: unknown): string {
  if (error instanceof KiwiError) {
    switch (error.code) {
      case "AuthenticationFailed":
        return "Kiwi authentication failed. Verify the base URL, username, and password settings.";
      case "AuthorizationFailed":
        return "Kiwi authorization failed. Your account cannot access this data.";
      case "ConnectionFailed":
        return "Kiwi connection failed. Verify the base URL and server status.";
      case "ValidationFailed":
        return error.message;
      default:
        return error.message;
    }
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export function logInBackground(
  logger: JsonlLogger,
  event: Parameters<JsonlLogger["log"]>[0]
): void {
  void logger.log(event).catch(() => undefined);
}

export function getTabUriString(tab: vscode.Tab): string | undefined {
  if (tab.input instanceof vscode.TabInputText) {
    return tab.input.uri.toString();
  }
  return undefined;
}
