import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("l10n resources", () => {
  it("covers package command titles in English and Japanese", () => {
    const packageJson = readJson("package.json") as {
      l10n?: string;
      contributes?: { commands?: Array<{ command?: string; title?: string }> };
    };
    const english = readJson("package.nls.json") as Record<string, string>;
    const japanese = readJson("package.nls.ja.json") as Record<string, string>;
    const keys = (packageJson.contributes?.commands ?? [])
      .map((command) => /^%(.+)%$/.exec(command.title ?? "")?.[1])
      .filter((key): key is string => key !== undefined);

    expect(packageJson.l10n).toBe("./l10n");
    expect(keys.length).toBe(packageJson.contributes?.commands?.length);
    expect(keys.filter((key) => english[key] === undefined)).toEqual([]);
    expect(keys.filter((key) => japanese[key] === undefined)).toEqual([]);
  });

  it("covers extension vscode.l10n.t string literals in English and Japanese bundles", () => {
    const source = readExtensionSourceText();
    const english = readJson("l10n/bundle.l10n.json") as Record<string, string>;
    const japanese = readJson("l10n/bundle.l10n.ja.json") as Record<string, string>;
    const keys = extractL10nLiteralKeys(source);

    expect(keys.length).toBeGreaterThan(0);
    expect(keys.filter((key) => english[key] === undefined)).toEqual([]);
    expect(keys.filter((key) => japanese[key] === undefined)).toEqual([]);
  });

  it("keeps English and Japanese l10n bundles aligned", () => {
    const english = readJson("l10n/bundle.l10n.json") as Record<string, string>;
    const japanese = readJson("l10n/bundle.l10n.ja.json") as Record<string, string>;

    expect(Object.keys(japanese).sort()).toEqual(Object.keys(english).sort());
  });

  it("keeps local mirror skill names and artifact paths language independent", () => {
    const source = readText("src/extension/llmSkillPackTemplates.ts");

    expect(source).toContain("kiwi-local-mirror-prompt");
    expect(source).toContain("kiwi-local-mirror-diff");
    expect(source).toContain(".kiwi-agent/prompt/current");
    expect(source).toContain(".kiwi-agent/diff/current");
  });
});

function readText(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

function readJson(path: string): unknown {
  return JSON.parse(readText(path));
}

function readExtensionSourceText(): string {
  return listTypeScriptFiles("src/extension")
    .map((path) => readText(path))
    .join("\n");
}

function listTypeScriptFiles(path: string): string[] {
  const entries = readdirSync(join(process.cwd(), path), { withFileTypes: true });
  return entries.flatMap((entry) => {
    const childPath = `${path}/${entry.name}`;
    if (entry.isDirectory()) {
      return listTypeScriptFiles(childPath);
    }
    return entry.isFile() && entry.name.endsWith(".ts") ? [childPath] : [];
  }).sort();
}

function extractL10nLiteralKeys(source: string): string[] {
  const keys = new Set<string>();
  const regexes = [
    /vscode\.l10n\.t\(\s*(["'`])((?:\\.|(?!\1)[\s\S])*?)\1/g,
    /localize\(\s*(["'`])((?:\\.|(?!\1)[\s\S])*?)\1/g
  ];
  for (const regex of regexes) {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(source)) !== null) {
      const raw = match[2] ?? "";
      keys.add(raw.replace(/\\(["'`\\])/g, "$1"));
    }
  }
  return [...keys].sort();
}
