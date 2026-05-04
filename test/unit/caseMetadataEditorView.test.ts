import { describe, expect, it, vi } from "vitest";
import { renderCaseMetadataEditorWebviewHtml } from "../../src/extension/webview/caseMetadataEditorView";

vi.mock("vscode", () => ({
  env: { language: "ja" },
  l10n: {
    t: (message: string, ...args: Array<string | number | boolean>) => {
      const translated: Record<string, string> = {
        Overview: "概要",
        Status: "ステータス",
        Priority: "優先度",
        Tags: "タグ",
        Template: "テンプレート",
        "Edit basic information. The body is not updated.": "基本情報を編集します。本文は更新しません。",
        "Use the selected template body as the initial body.": "選択したテンプレートの本文を初期本文として作成します。",
        Save: "保存",
        Reload: "再読み込み",
        Cancel: "キャンセル"
      };
      const template = translated[message] ?? message;
      return args.reduce<string>((current, value, index) => current.replace(`{${index}}`, String(value)), template);
    }
  }
}));

describe("caseMetadataEditorView", () => {
  it("renders user-facing metadata labels in Japanese", () => {
    const html = renderCaseMetadataEditorWebviewHtml({} as never, "テストケースの基本情報を編集", {
      mode: "edit",
      formState: {
        summary: "Login works",
        status: "CONFIRMED",
        priority: "P1",
        tagsInput: "smoke"
      },
      options: {
        statuses: ["CONFIRMED"],
        priorities: ["P1"]
      },
      templateOptions: [],
      selectedTemplateId: undefined,
      templateWarning: undefined,
      isSaving: false,
      actionLabel: "保存"
    });

    expect(html).toContain("<label>概要");
    expect(html).toContain("<label>ステータス");
    expect(html).toContain("<label>優先度");
    expect(html).toContain("<label>タグ");
    expect(html).toContain("<label id=\"templateLabel\">テンプレート");
    expect(html).toContain("基本情報を編集します。本文は更新しません。");
    expect(html).not.toContain("<label>Summary");
    expect(html).not.toContain("<label>Status");
    expect(html).not.toContain("<label>Priority");
    expect(html).not.toContain("<label>Tags");
  });
});
