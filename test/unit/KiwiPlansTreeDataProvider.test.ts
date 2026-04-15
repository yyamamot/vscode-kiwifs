import { describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => {
  class EventEmitter<T> {
    readonly event = vi.fn();
    fire = vi.fn((_value?: T) => undefined);
  }
  class TreeItem {
    label: string;
    collapsibleState: number;
    contextValue?: string;
    resourceUri?: unknown;
    command?: unknown;
    description?: string;
    tooltip?: string;
    iconPath?: unknown;

    constructor(label: string, collapsibleState: number) {
      this.label = label;
      this.collapsibleState = collapsibleState;
    }
  }
  class ThemeIcon {
    constructor(readonly id: string, readonly color?: unknown) {}
  }
  class ThemeColor {
    constructor(readonly id: string) {}
  }

  return {
    EventEmitter,
    TreeItem,
    ThemeIcon,
    ThemeColor,
    TreeItemCollapsibleState: {
      None: 0,
      Collapsed: 1
    },
    Uri: {
      parse: (value: string) => ({ toString: () => value })
    },
    window: {
      showErrorMessage: vi.fn()
    },
    FileSystemError: class FileSystemError extends Error {}
  };
});

import {
  KiwiPlansTreeDataProvider,
  type KiwiPlansTreeNode
} from "../../src/extension/KiwiPlansTreeDataProvider";
import { JsonlLogger } from "../../src/logging/jsonlLogger";

describe("KiwiPlansTreeDataProvider freshness decoration", () => {
  it("decorates stale case tree items and clears decoration", async () => {
    const provider = new KiwiPlansTreeDataProvider(
      async () => {
        throw new Error("not used");
      },
      { log: vi.fn(async () => undefined) } as unknown as JsonlLogger
    );
    const node: KiwiPlansTreeNode = {
      kind: "case",
      plan: { id: 100, name: "Regression" },
      caseRef: { id: 501, summary: "Login works" }
    };

    provider.markCaseStale(501, "remote が更新されています。");

    const staleItem = await provider.getTreeItem(node);
    expect(staleItem.description).toBe("remote changed");
    expect(staleItem.tooltip).toContain("remote が更新されています。");
    expect(staleItem.iconPath).toMatchObject({
      id: "warning",
      color: { id: "problemsWarningIcon.foreground" }
    });

    provider.clearCaseFreshness(501);

    const freshItem = await provider.getTreeItem(node);
    expect(freshItem.description).toBeUndefined();
    expect(freshItem.tooltip).toBeUndefined();
    expect(freshItem.iconPath).toBeUndefined();
  });
});
