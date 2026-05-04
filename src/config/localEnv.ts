import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";

let cachedEnvPath: string | undefined;
let cachedValues: Map<string, string> | undefined;

export function localEnvValue(name: string): string | undefined {
  const envPath = resolveLocalEnvPath();
  if (!envPath) {
    return undefined;
  }

  if (cachedEnvPath !== envPath || !cachedValues) {
    cachedEnvPath = envPath;
    cachedValues = parseDotEnv(readFileSync(envPath, "utf8"));
  }

  return cachedValues.get(name);
}

export function resolveLocalEnvPath(): string | undefined {
  const runtimeRoot = process.env.KIWI_RUNTIME_ROOT?.trim();
  if (runtimeRoot) {
    const candidate = path.join(runtimeRoot, ".env");
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  const workspaceFolder = vscode.workspace.workspaceFolders?.find(
    (folder) => folder.uri.scheme === "file"
  );
  if (workspaceFolder) {
    const candidate = path.join(workspaceFolder.uri.fsPath, ".env");
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  const workspaceFile = vscode.workspace.workspaceFile;
  if (workspaceFile?.scheme === "file") {
    const candidate = path.join(path.dirname(workspaceFile.fsPath), ".env");
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

export function isLocalEnvResolved(): boolean {
  return Boolean(resolveLocalEnvPath());
}

function parseDotEnv(content: string): Map<string, string> {
  const values = new Map<string, string>();

  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separator = line.indexOf("=");
    if (separator <= 0) {
      continue;
    }

    const key = line.slice(0, separator).trim();
    const rawValue = line.slice(separator + 1).trim();
    const value = unquote(rawValue);
    if (key) {
      values.set(key, value);
    }
  }

  return values;
}

function unquote(value: string): string {
  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}
