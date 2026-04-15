import * as vscode from "vscode";
import { KiwiConfig } from "../types";
import { KiwiError } from "../domain/errors";
import { localEnvValue } from "./localEnv";
import { normalizeBaseUrl, normalizeBaseUrlInput, normalizeSecretInput } from "./configInput";

const USERNAME_SECRET_KEY = "kiwi.username";
const PASSWORD_SECRET_KEY = "kiwi.password";

export { USERNAME_SECRET_KEY, PASSWORD_SECRET_KEY };

export async function resolveKiwiConfig(
  context: vscode.ExtensionContext
): Promise<KiwiConfig> {
  const configuration = vscode.workspace.getConfiguration("kiwi");
  const allowLocalEnvFallback = process.env.KIWI_RUNTIME_MODE === "debug-f5";
  const baseUrl =
    stringOrUndefined(configuration.get<string>("baseUrl")) ??
    envValue("KIWI_BASE_URL", allowLocalEnvFallback);
  const username =
    stringOrUndefined(await context.secrets.get(USERNAME_SECRET_KEY)) ??
    envValue("KIWI_USERNAME", allowLocalEnvFallback);
  const password =
    stringOrUndefined(await context.secrets.get(PASSWORD_SECRET_KEY)) ??
    envValue("KIWI_PASSWORD", allowLocalEnvFallback);

  if (!baseUrl || !username || !password) {
    throw new KiwiError(
      "AuthenticationFailed",
      "Kiwi configuration is incomplete. Set the base URL, username, and password."
    );
  }

  return {
    baseUrl: normalizeBaseUrl(baseUrl),
    username,
    password
  };
}

export async function storeCredentials(
  context: vscode.ExtensionContext,
  username: string,
  password: string
): Promise<void> {
  await storeUsername(context, username);
  await storePassword(context, password);
}

export async function storeUsername(
  context: vscode.ExtensionContext,
  username: string
): Promise<void> {
  await context.secrets.store(USERNAME_SECRET_KEY, username);
}

export async function clearUsername(context: vscode.ExtensionContext): Promise<void> {
  await context.secrets.delete(USERNAME_SECRET_KEY);
}

export async function storePassword(
  context: vscode.ExtensionContext,
  password: string
): Promise<void> {
  await context.secrets.store(PASSWORD_SECRET_KEY, password);
}

export async function clearPassword(context: vscode.ExtensionContext): Promise<void> {
  await context.secrets.delete(PASSWORD_SECRET_KEY);
}

export async function clearCredentials(context: vscode.ExtensionContext): Promise<void> {
  await clearUsername(context);
  await clearPassword(context);
}

export async function readStoredUsername(
  context: vscode.ExtensionContext
): Promise<string | undefined> {
  return stringOrUndefined(await context.secrets.get(USERNAME_SECRET_KEY));
}

export async function readStoredPassword(
  context: vscode.ExtensionContext
): Promise<string | undefined> {
  return stringOrUndefined(await context.secrets.get(PASSWORD_SECRET_KEY));
}

export { normalizeBaseUrlInput, normalizeSecretInput };

function envValue(name: string, allowLocalEnvFallback: boolean): string | undefined {
  const value = process.env[name] ?? (allowLocalEnvFallback ? localEnvValue(name) : undefined);
  return stringOrUndefined(value);
}

function stringOrUndefined(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
