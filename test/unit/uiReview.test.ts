import { describe, expect, it } from "vitest";
import {
  createUiReviewReport,
  evaluateTreeViewContextMenuState,
  evaluateUiReviewSnapshot,
  resultForUiReviewChecks,
  type UiReviewMenuState,
  type UiReviewElement,
  type UiReviewSnapshot
} from "../../src/harness/ui-review";

describe("ui-review", () => {
  it("passes a valid case filter snapshot", () => {
    const checks = evaluateUiReviewSnapshot(snapshot([
      element("shell", "BODY", { width: 1000, height: 700, clientWidth: 1000, clientHeight: 700 }),
      element("filter-form", "FORM", { width: 960, height: 140, clientWidth: 960, clientHeight: 140 }),
      element("bulk-actions", "DIV", { width: 960, height: 40, clientWidth: 960, clientHeight: 40 }),
      element("result-list", "TABLE", { width: 960, height: 240, clientWidth: 960, clientHeight: 240 }),
      element("search-button", "BUTTON", { width: 80, height: 32, clientWidth: 80, clientHeight: 32 })
    ]));

    expect(resultForUiReviewChecks(checks)).toBe("pass");
    expect(checks.every((check) => check.passed)).toBe(true);
  });

  it("fails when required visible regions are missing", () => {
    const checks = evaluateUiReviewSnapshot(snapshot([
      element("shell", "BODY", { width: 1000, height: 700, clientWidth: 1000, clientHeight: 700 }),
      element("filter-form", "FORM", { width: 960, height: 140, clientWidth: 960, clientHeight: 140 })
    ]));

    expect(resultForUiReviewChecks(checks)).toBe("needs-fix");
    expect(checks.some((check) => check.id === "required-visible-result-list" && !check.passed)).toBe(true);
    expect(checks.some((check) => check.id === "required-present-bulk-actions" && !check.passed)).toBe(true);
  });

  it("detects clipping in controls", () => {
    const checks = evaluateUiReviewSnapshot(snapshot([
      ...baseElements(),
      element("search-button", "BUTTON", {
        width: 80,
        height: 32,
        clientWidth: 80,
        clientHeight: 32,
        scrollWidth: 120
      })
    ]));

    expect(resultForUiReviewChecks(checks)).toBe("needs-fix");
    expect(checks.some((check) => check.id === "clipping-search-button" && !check.passed)).toBe(true);
  });

  it("detects viewport escape", () => {
    const checks = evaluateUiReviewSnapshot(snapshot([
      ...baseElements(),
      element("clear-button", "BUTTON", {
        x: 1200,
        left: 1200,
        right: 1280,
        width: 80,
        height: 32,
        clientWidth: 80,
        clientHeight: 32
      })
    ]));

    expect(resultForUiReviewChecks(checks)).toBe("needs-fix");
    expect(checks.some((check) => check.id === "viewport-clear-button" && !check.passed)).toBe(true);
  });

  it("detects major region overflow", () => {
    const checks = evaluateUiReviewSnapshot(snapshot([
      element("shell", "BODY", { width: 1000, height: 700, clientWidth: 1000, clientHeight: 700 }),
      element("filter-form", "FORM", { width: 960, height: 140, clientWidth: 960, clientHeight: 140 }),
      element("bulk-actions", "DIV", { width: 960, height: 40, clientWidth: 960, clientHeight: 40 }),
      element("result-list", "TABLE", {
        width: 960,
        height: 240,
        clientWidth: 960,
        clientHeight: 240,
        scrollWidth: 1200
      })
    ]));

    expect(resultForUiReviewChecks(checks)).toBe("needs-fix");
    expect(checks.some((check) => check.id === "overflow-result-list" && !check.passed)).toBe(true);
  });

  it("creates an aggregate report", () => {
    const checks = evaluateUiReviewSnapshot(snapshot(baseElements()));
    const report = createUiReviewReport([
      {
        id: "case-filter",
        result: resultForUiReviewChecks(checks),
        checks,
        artifactPaths: { snapshot: "/tmp/snapshot.json" }
      }
    ]);

    expect(report.result).toBe("pass");
    expect(report.findings).toEqual([]);
    expect(report.humanReviewNeeded.length).toBeGreaterThan(0);
  });

  it("passes a valid TreeView context menu state", () => {
    const checks = evaluateTreeViewContextMenuState(menuState());

    expect(resultForUiReviewChecks(checks)).toBe("pass");
    expect(checks.filter((check) => !check.passed && check.severity === "error")).toEqual([]);
  });

  it("fails when a required TreeView command is missing", () => {
    const state = menuState();
    state.menus.viewItemContext = state.menus.viewItemContext.filter(
      (item) => item.command !== "kiwi.showPlanTreeItemActions"
    );
    const checks = evaluateTreeViewContextMenuState(state);

    expect(resultForUiReviewChecks(checks)).toBe("needs-fix");
    expect(checks.some((check) => check.id === "treeview-plan-required-kiwi.showPlanTreeItemActions" && !check.passed)).toBe(true);
  });

  it("fails when TreeView menu when clauses are too broad", () => {
    const state = menuState();
    state.menus.viewItemContext.push({
      command: "kiwi.showPlanInfo",
      when: "view == kiwiPlans",
      group: "inspect@1"
    });
    const checks = evaluateTreeViewContextMenuState(state);

    expect(resultForUiReviewChecks(checks)).toBe("needs-fix");
    expect(checks.some((check) => check.id === "treeview-menu-when-kiwi.showPlanInfo" && !check.passed)).toBe(true);
  });

  it("fails when delete case is contributed to plan items", () => {
    const state = menuState();
    state.menus.viewItemContext.push({
      command: "kiwi.deleteCase",
      when: "view == kiwiPlans && viewItem == plan",
      group: "inspect@4.5"
    });
    const checks = evaluateTreeViewContextMenuState(state);

    expect(resultForUiReviewChecks(checks)).toBe("needs-fix");
    expect(checks.some((check) => check.id === "treeview-delete-case-only-case-item" && !check.passed)).toBe(true);
  });

  it("does not fail the gate for native context menu capture failure alone", () => {
    const state = menuState();
    state.nativeContextMenus = [
      {
        name: "case-shift-f10",
        target: "case",
        status: "capture-failed",
        reason: "System Events unavailable"
      }
    ];
    const checks = evaluateTreeViewContextMenuState(state);

    expect(resultForUiReviewChecks(checks)).toBe("pass");
    expect(checks.some((check) => check.id === "treeview-native-context-menu-case" && !check.passed && check.severity === "info")).toBe(true);
  });
});

function menuState(): UiReviewMenuState {
  const planWhen = "view == kiwiPlans && viewItem == plan";
  const caseWhen = "view == kiwiPlans && viewItem == caseDocument";
  const planCommands = [
    "kiwi.openPlanInBrowser",
    "kiwi.showPlanTreeItemActions",
    "kiwi.createCase",
    "kiwi.addExistingCaseToPlan",
    "kiwi.downloadPlanToLocalMirror",
    "kiwi.comparePlanLocalMirror"
  ];
  const caseCommands = [
    "kiwi.openInBrowser",
    "kiwi.refreshCaseDocument",
    "kiwi.editCaseMetadata",
    "kiwi.manageCaseExecutionsAcrossRuns",
    "kiwi.showCaseTreeItemActions",
    "kiwi.downloadCaseToLocalMirror",
    "kiwi.compareLocalMirror",
    "kiwi.removeCaseFromPlan",
    "kiwi.deleteCase"
  ];
  const caseSurfaceCommands = [
    ...caseCommands,
    "kiwi.recordCaseExecutionResult"
  ];
  return {
    capturedAt: "2026-05-02T00:00:00.000Z",
    scenarioId: "treeview-context-menu",
    menus: {
      viewItemContext: [
        ...planCommands.map((command, index) => ({
          command,
          when: planWhen,
          group: `inspect@${index + 1}`
        })),
        ...caseCommands.map((command, index) => ({
          command,
          when: caseWhen,
          group: command === "kiwi.removeCaseFromPlan"
            ? "06_danger@1"
            : command === "kiwi.deleteCase"
              ? "06_danger@2"
              : `02_inspect@${index + 1}`
        }))
      ],
      commandPalette: [
        { command: "kiwi.deleteCase", when: "false" },
        { command: "kiwi.removeCaseFromPlanFromPlan", when: "false" },
        { command: "kiwi.uploadLocalMirror", when: "false" },
        { command: "kiwi.uploadPlanLocalMirror", when: "false" },
        { command: "kiwi.scmUploadLocalMirrorResources", when: "false" },
        { command: "kiwi.scmCompareLocalMirrorAgain", when: "false" },
        { command: "kiwi.scmCheckRemoteLocalMirrorMetadata", when: "false" },
        { command: "kiwi.scmTakeRemoteLocalMirrorResources", when: "false" },
        { command: "kiwi.showTreeItemActions", when: "false" },
        { command: "kiwi.showPlanTreeItemActions", when: "false" },
        { command: "kiwi.showCaseTreeItemActions", when: "false" }
      ]
    },
    actionSurfaces: [
      {
        target: "plan",
        screenshot: "/tmp/plan.png",
        overview: {
          rows: [
            { label: "テスト計画ID", value: "100" },
            { label: "名前", value: "Regression" },
            { label: "説明", value: "-" },
            { label: "配下テストケース数", value: "4" },
            { label: "テスト実行数", value: "1" },
            { label: "ローカルミラー", value: "未比較" }
          ]
        },
        items: planCommands.map((command) => ({
          id: command,
          category: "inspect",
          label: command,
          command,
          mode: "normal"
        }))
      },
      {
        target: "case",
        screenshot: "/tmp/case.png",
        items: caseSurfaceCommands.map((command) => ({
          id: command,
          category: command === "kiwi.recordCaseExecutionResult" || command === "kiwi.manageCaseExecutionsAcrossRuns"
            ? "execution"
            : "inspect",
          label: command === "kiwi.recordCaseExecutionResult"
            ? "テスト実行結果を更新"
            : command === "kiwi.manageCaseExecutionsAcrossRuns"
              ? "テスト実行を管理"
              : command,
          command,
          mode: "normal"
        }))
      }
    ]
  };
}

function baseElements(): UiReviewElement[] {
  return [
    element("shell", "BODY", { width: 1000, height: 700, clientWidth: 1000, clientHeight: 700 }),
    element("filter-form", "FORM", { width: 960, height: 140, clientWidth: 960, clientHeight: 140 }),
    element("bulk-actions", "DIV", { width: 960, height: 40, clientWidth: 960, clientHeight: 40 }),
    element("result-list", "TABLE", { width: 960, height: 240, clientWidth: 960, clientHeight: 240 })
  ];
}

function snapshot(elements: UiReviewElement[]): UiReviewSnapshot {
  return {
    capturedAt: "2026-04-28T00:00:00.000Z",
    reason: "unit-test",
    selfReview: {
      screen: "case-filter",
      hasResults: true,
      selectedCount: 0,
      resultCount: 1
    },
    geometry: {
      viewport: {
        width: 1000,
        height: 700
      },
      elements
    }
  };
}

function element(
  reviewId: string,
  tagName: string,
  overrides: Partial<UiReviewElement["rect"] & Pick<UiReviewElement, "clientWidth" | "clientHeight" | "scrollWidth" | "scrollHeight">>
): UiReviewElement {
  const x = overrides.x ?? 0;
  const y = overrides.y ?? 0;
  const width = overrides.width ?? 100;
  const height = overrides.height ?? 40;
  return {
    reviewId,
    tagName,
    role: "",
    label: reviewId,
    visible: true,
    disabled: false,
    rect: {
      x,
      y,
      width,
      height,
      top: overrides.top ?? y,
      right: overrides.right ?? x + width,
      bottom: overrides.bottom ?? y + height,
      left: overrides.left ?? x
    },
    scrollWidth: overrides.scrollWidth ?? overrides.clientWidth ?? width,
    scrollHeight: overrides.scrollHeight ?? overrides.clientHeight ?? height,
    clientWidth: overrides.clientWidth ?? width,
    clientHeight: overrides.clientHeight ?? height
  };
}
