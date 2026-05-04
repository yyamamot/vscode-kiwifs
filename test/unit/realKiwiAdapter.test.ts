import { describe, expect, it } from "vitest";
import { KiwiConfig } from "../../src/types";
import {
  filenameFromUrl,
  parseContentDispositionFilename,
  RealKiwiAdapter,
  toKiwiError
} from "../../src/adapter/realKiwiAdapter";
import { createCredentialCacheKey } from "../../src/adapter/realKiwi/credentialCacheKey";
import { KiwiError } from "../../src/domain/errors";

describe("realKiwiAdapter", () => {
  const config: KiwiConfig = {
    baseUrl: "https://localhost:8443",
    username: "admin",
    password: "admin"
  };

  it("maps RPC case payload into KiwiCase", async () => {
    const session = new FakeSession({
      "TestCase.filter": [
        [
          {
            id: 501,
            summary: "Login works",
            priority__value: "P1",
            category__name: "Functional",
            case_status__name: "CONFIRMED",
            text: "# Existing body\n\n1. Open page",
            notes: "Keep smoke coverage."
          }
        ]
      ],
      "TestPlan.filter": [[{ id: 100, name: "Regression", text: "", product: 1 }]],
      "Tag.filter": [[{ id: 1, name: "smoke" }]],
      "Component.filter": [[{ id: 7, name: "Auth" }]]
    });
    const adapter = new RealKiwiAdapter(() => session);

    const result = await adapter.getCase(config, 501);

    expect(result).toEqual({
      id: 501,
      planId: 100,
      summary: "Login works",
      priority: "P1",
      category: "Functional",
      status: "CONFIRMED",
      components: ["Auth"],
      tags: ["smoke"],
      notes: "Keep smoke coverage.",
      text: "# Existing body\n\n1. Open page"
    });
  });

  it("keeps raw remote text without section decoding", async () => {
    const session = new FakeSession({
      "TestCase.filter": [
        [
          {
            id: 10,
            summary: "Legacy case",
            priority__value: "P2",
            category__name: "Legacy",
            case_status__name: "CONFIRMED",
            text: "Unstructured legacy text",
            notes: ""
          }
        ]
      ],
      "TestPlan.filter": [[{ id: 3, name: "Plan", text: "", product: 1 }]],
      "Tag.filter": [[]],
      "Component.filter": [[]]
    });
    const adapter = new RealKiwiAdapter(() => session);

    const result = await adapter.getCase(config, 10);

    expect(result.text).toBe("Unstructured legacy text");
  });

  it("fetches case body without metadata fan-out", async () => {
    const session = new FakeSession({
      "TestCase.filter": [
        [
          {
            id: 501,
            summary: "Login works",
            text: "# Existing body\n\n1. Open page"
          }
        ]
      ]
    });
    const adapter = new RealKiwiAdapter(() => session);

    const result = await adapter.getCaseBody(config, 501, 100);

    expect(result).toEqual({
      id: 501,
      planId: 100,
      summary: "Login works",
      text: "# Existing body\n\n1. Open page"
    });
    expect(session.calls.map((call) => call.method)).toEqual(["TestCase.filter"]);
  });

  it("updates only remote text in v1", async () => {
    const session = new FakeSession({
      "TestCase.update": [[{ id: 501 }]],
      "TestPlan.filter": [[{ id: 100, name: "Regression", text: "", product: 1 }]],
      "Tag.filter": [
        [{ id: 1, name: "keep" }]
      ],
      "Component.filter": [
        [{ id: 11, name: "Auth" }]
      ],
      "TestCase.filter": [
        [
          {
            id: 501,
            summary: "Login still works",
            priority__value: "P1",
            category__name: "Functional",
            case_status__name: "CONFIRMED",
            text: "# Updated body\n\n1. Open page",
            notes: "Updated."
          }
        ]
      ]
    });
    const adapter = new RealKiwiAdapter(() => session);

    const result = await adapter.updateCaseText(config, 501, "# Updated body\n\n1. Open page");

    expect(result.summary).toBe("Login still works");
    expect(session.calls).toContainEqual({
      method: "TestCase.update",
      params: [
        501,
        {
          text: "# Updated body\n\n1. Open page"
        }
      ]
    });
    expect(
      session.calls.some((call) =>
        ["TestCase.add_tag", "TestCase.remove_tag", "TestCase.add_component", "TestCase.remove_component"].includes(
          call.method
        )
      )
    ).toBe(false);
  });

  it("updates summary priority status and tags through dedicated metadata flow", async () => {
    const session = new FakeSession({
      "Priority.filter": [[{ id: 2, value: "P2" }]],
      "TestCaseStatus.filter": [[{ id: 5, name: "IDLE" }]],
      "Tag.filter": [
        [{ id: 1, name: "smoke" }],
        [{ id: 1, name: "regression" }, { id: 2, name: "smoke" }]
      ],
      "TestCase.add_tag": [[undefined]],
      "TestCase.update": [[{ id: 501 }]],
      "TestPlan.filter": [[{ id: 100, name: "Regression", text: "", product: 1 }]],
      "Component.filter": [[{ id: 11, name: "Auth" }]],
      "TestCase.filter": [
        [{ id: 501, summary: "Login works" }],
        [
          {
            id: 501,
            summary: "Login updated",
            priority__value: "P2",
            category__name: "Functional",
            case_status__name: "IDLE",
            text: "# Body",
            notes: "Updated."
          }
        ]
      ]
    });
    const adapter = new RealKiwiAdapter(() => session);

    const result = await adapter.updateCaseMetadata(config, 501, {
      summary: "Login updated",
      priority: "P2",
      status: "IDLE",
      tags: ["regression", "smoke"]
    });

    expect(result.summary).toBe("Login updated");
    expect(result.priority).toBe("P2");
    expect(result.status).toBe("IDLE");
    expect(result.tags).toEqual(["regression", "smoke"]);
    expect(session.calls).toContainEqual({
      method: "TestCase.update",
      params: [
        501,
        {
          summary: "Login updated",
          priority: 2,
          case_status: 5
        }
      ]
    });
    expect(session.calls).toContainEqual({
      method: "TestCase.add_tag",
      params: [501, "regression"]
    });
  });

  it("fails metadata update when status is unknown", async () => {
    const session = new FakeSession({
      "TestCase.filter": [[{ id: 501, summary: "Login works" }]],
      "TestCaseStatus.filter": [[]]
    });
    const adapter = new RealKiwiAdapter(() => session);

    await expect(
      adapter.updateCaseMetadata(config, 501, {
        status: "UNKNOWN"
      })
    ).rejects.toMatchObject({
      code: "ValidationFailed"
    });
  });

  it("lists metadata option values", async () => {
    const session = new FakeSession({
      "TestCaseStatus.filter": [[{ id: 1, name: "CONFIRMED" }, { id: 2, name: "IDLE" }]],
      "Priority.filter": [[{ id: 1, value: "P1" }, { id: 2, value: "P2" }]]
    });
    const adapter = new RealKiwiAdapter(() => session);

    await expect(adapter.listCaseStatuses(config)).resolves.toEqual(["CONFIRMED", "IDLE"]);
    await expect(adapter.listPriorities(config)).resolves.toEqual(["P1", "P2"]);
  });

  it("searches cases through TestCase.filter", async () => {
    const session = new FakeSession({
      "TestCase.filter": [
        [{ id: 501, summary: "Login works", text: "Open login page" }],
        [{ id: 502, summary: "Password reset", text: "Reset with email token" }],
        [{ id: 501, summary: "Case 501", text: "Numeric summary match" }],
        [{ id: 501, summary: "Case 501 exact", text: "Numeric id match" }]
      ]
    });
    const adapter = new RealKiwiAdapter(() => session);

    await expect(adapter.searchCases(config, { query: "Login", mode: "id-summary" })).resolves.toEqual([
      { caseId: 501, summary: "Login works", textSnippet: undefined }
    ]);
    await expect(adapter.searchCases(config, { query: "email", mode: "body" })).resolves.toEqual([
      { caseId: 502, summary: "Password reset", textSnippet: "Reset with email token" }
    ]);
    await expect(adapter.searchCases(config, { query: "501", mode: "id-summary" })).resolves.toEqual([
      { caseId: 501, summary: "Case 501 exact", textSnippet: undefined }
    ]);
    expect(session.calls).toContainEqual({
      method: "TestCase.filter",
      params: [{ summary__icontains: "Login" }]
    });
    expect(session.calls).toContainEqual({
      method: "TestCase.filter",
      params: [{ text__icontains: "email" }]
    });
    expect(session.calls).toContainEqual({
      method: "TestCase.filter",
      params: [{ summary__icontains: "501" }]
    });
    expect(session.calls).toContainEqual({
      method: "TestCase.filter",
      params: [{ id: 501 }]
    });
  });

  it("creates a case and links it to the selected plan", async () => {
    const session = new FakeSession({
      "TestPlan.filter": [
        [{ id: 100, name: "Regression", text: "", product: 1 }],
        [{ id: 100, name: "Regression", text: "", product: 1 }],
        [{ id: 100, name: "Regression", text: "", product: 1 }]
      ],
      "TestCase.filter": [
        [],
        [{ id: 502, summary: "Login copied" }],
        [
          {
            id: 502,
            summary: "Login copied",
            priority__value: "P2",
            category__name: "Functional",
            case_status__name: "IDLE",
            text: "# Purpose\n\n# Steps\n\n# Expected Result\n",
            notes: ""
          }
        ],
        [
          {
            id: 502,
            summary: "Login copied",
            priority__value: "P2",
            category__name: "Functional",
            case_status__name: "IDLE",
            text: "# Purpose\n\n# Steps\n\n# Expected Result\n",
            notes: ""
          }
        ]
      ],
      "Category.filter": [[{ id: 135, name: "Functional" }]],
      "Priority.filter": [[{ id: 2, value: "P2" }]],
      "TestCase.create": [{ id: 502 }],
      "TestPlan.add_case": [{ id: 502, sortkey: 10 }],
      "TestCase.update": [
        { id: 502, text: "# Purpose\n\n# Steps\n\n# Expected Result\n" },
        { id: 502 }
      ],
      "TestCaseStatus.filter": [[{ id: 5, name: "IDLE" }]],
      "Tag.filter": [
        [],
        [{ id: 1, name: "regression" }, { id: 2, name: "smoke" }],
        [{ id: 1, name: "regression" }, { id: 2, name: "smoke" }]
      ],
      "TestCase.add_tag": [undefined, undefined],
      "Component.filter": [[], []]
    });
    const adapter = new RealKiwiAdapter(() => session);

    const result = await adapter.createCase(config, 100, {
      summary: "Login copied",
      priority: "P2",
      status: "IDLE",
      tags: ["regression", "smoke"],
      text: "# Purpose\n\n# Steps\n\n# Expected Result\n"
    });

    expect(result.id).toBe(502);
    expect(result.summary).toBe("Login copied");
    expect(result.status).toBe("IDLE");
    expect(result.priority).toBe("P2");
    expect(result.tags).toEqual(["regression", "smoke"]);
    expect(session.calls).toContainEqual({
      method: "TestCase.create",
      params: [
        {
          category: 135,
          product: 1,
          summary: "Login copied",
          priority: 2,
          case_status: 5
        }
      ]
    });
    expect(session.calls).toContainEqual({
      method: "TestPlan.add_case",
      params: [100, 502]
    });
  });

  it("lists case templates from Kiwi", async () => {
    const session = new FakeSession({
      "Template.filter": [
        [
          { id: 20, name: "Smoke", text: "# Smoke" },
          { id: 10, name: "Regression", text: "# Regression" }
        ]
      ]
    });
    const adapter = new RealKiwiAdapter(() => session);

    await expect(adapter.listCaseTemplates(config)).resolves.toEqual([
      { id: 10, name: "Regression", text: "# Regression" },
      { id: 20, name: "Smoke", text: "# Smoke" }
    ]);
    expect(session.calls).toContainEqual({
      method: "Template.filter",
      params: [{}]
    });
  });

  it("links an existing case to a selected plan", async () => {
    const session = new FakeSession({
      "TestPlan.filter": [[{ id: 100, name: "Regression", text: "", product: 1 }]],
      "TestCase.filter": [[{ id: 501, summary: "Login works" }]],
      "TestPlan.add_case": [{ id: 501, sortkey: 10 }]
    });
    const adapter = new RealKiwiAdapter(() => session);

    await adapter.addCaseToPlan(config, 100, 501);

    expect(session.calls).toContainEqual({
      method: "TestPlan.add_case",
      params: [100, 501]
    });
  });

  it("unlinks an existing case from a selected plan", async () => {
    const session = new FakeSession({
      "TestPlan.filter": [[{ id: 100, name: "Regression", text: "", product: 1 }]],
      "TestCase.filter": [[{ id: 501, summary: "Login works" }]],
      "TestPlan.remove_case": [undefined]
    });
    const adapter = new RealKiwiAdapter(() => session);

    await adapter.removeCaseFromPlan(config, 100, 501);

    expect(session.calls).toContainEqual({
      method: "TestPlan.remove_case",
      params: [100, 501]
    });
  });

  it("deletes an existing case", async () => {
    const session = new FakeSession({
      "TestCase.filter": [[{ id: 501, summary: "Login works" }]],
      "TestCase.remove": [undefined]
    });
    const adapter = new RealKiwiAdapter(() => session);

    await adapter.deleteCase(config, 501);

    expect(session.calls).toContainEqual({
      method: "TestCase.remove",
      params: [{ pk: 501 }]
    });
  });

  it("filters test runs by query, plan, and build", async () => {
    const session = new FakeSession({
      "TestRun.filter": [
        [
          { id: 300, summary: "Regression run", build__name: "2026.04", plan: 100 },
          { id: 301, summary: "Regression run", build__name: "2026.04-nightly", plan: 100 }
        ]
      ]
    });
    const adapter = new RealKiwiAdapter(() => session);

    const runs = await adapter.searchTestRuns(config, {
      query: "Regression",
      planId: 100,
      build: "2026.04"
    });

    expect(runs).toEqual([{ id: 300, summary: "Regression run", build: "2026.04", planId: 100 }]);
    expect(session.calls).toContainEqual({
      method: "TestRun.filter",
      params: [{ plan: 100, summary__icontains: "Regression" }]
    });
  });

  it("lists and updates execution results", async () => {
    const session = new FakeSession({
      "TestRun.filter": [
        [{ id: 300, summary: "Regression run", build__name: "2026.04", plan: 100 }],
        [{ id: 300, summary: "Regression run", plan: 100 }],
        [{ id: 300, summary: "Regression run", plan: 100 }]
      ],
      "TestCase.filter": [[{ id: 501, summary: "Login works" }]],
      "TestExecution.filter": [
        [
          {
            id: 9001,
            run: 300,
            case: 501,
            case__summary: "Login works",
            build__name: "2026.04",
            status__name: "IDLE"
          }
        ],
        [
          {
            id: 9001,
            run: 300,
            case: 501,
            case__summary: "Login works",
            build__name: "2026.04",
            status__name: "IDLE"
          }
        ],
        [
          {
            id: 9001,
            run: 300,
            case: 501,
            case__summary: "Login works",
            build__name: "2026.04",
            status__name: "PASSED"
          }
        ]
      ],
      "TestExecutionStatus.filter": [[{ id: 2, name: "PASSED" }]],
      "TestExecution.update": [
        {
          id: 9001,
          run: 300,
          case: 501,
          case__summary: "Login works",
          build__name: "2026.04",
          status__name: "PASSED"
        }
      ],
      "TestExecution.add_comment": [undefined]
    });
    const adapter = new RealKiwiAdapter(() => session);

    const runs = await adapter.listTestRuns(config);
    expect(runs).toEqual([{ id: 300, summary: "Regression run", build: "2026.04", planId: 100 }]);
    const executions = await adapter.listCaseExecutions(config, 501);
    expect(executions[0]).toMatchObject({
      id: 9001,
      runId: 300,
      runSummary: "Regression run",
      caseId: 501,
      status: "IDLE"
    });

    const updated = await adapter.updateExecution(config, 9001, {
      status: "PASSED",
      comment: "Verified"
    });
    expect(updated.status).toBe("PASSED");
    expect(updated.comment).toBe("Verified");
    expect(session.calls).toContainEqual({
      method: "TestExecution.update",
      params: [9001, { status: 2 }]
    });
    expect(session.calls).toContainEqual({
      method: "TestExecution.add_comment",
      params: [9001, "Verified"]
    });
    const runExecutions = await adapter.listRunExecutions(config, 300);
    expect(runExecutions[0]?.runSummary).toBe("Regression run");
  });

  it("creates test runs and adds cases to runs via XML-RPC", async () => {
    const session = new FakeSession({
      "Auth.login": [true],
      "TestPlan.filter": [[{ id: 100, name: "Regression", product: 1 }]],
      "Build.filter": [[{ id: 10, name: "2026.04-phase3" }]],
      "TestRun.create": [{ id: 302 }],
      "TestRun.filter": [
        [
          {
            id: 302,
            summary: "Created from VS Code",
            build__name: "2026.04-phase3",
            plan: 100,
            manager__username: "admin"
          }
        ],
        [
          {
            id: 302,
            summary: "Created from VS Code",
            build__name: "2026.04-phase3",
            plan: 100,
            manager__username: "admin"
          }
        ]
      ],
      "TestCase.filter": [[{ id: 501, summary: "Login works" }]],
      "TestRun.add_case": [undefined]
    });
    const adapter = new RealKiwiAdapter(() => session);

    const builds = await adapter.listBuildsForPlan(config, 100);
    expect(builds).toEqual([{ id: 10, name: "2026.04-phase3" }]);
    expect(session.calls).toContainEqual({
      method: "Build.filter",
      params: [{ version__product: 1 }]
    });

    const created = await adapter.createTestRun(config, {
      summary: "Created from VS Code",
      planId: 100,
      buildId: 10,
      manager: "admin"
    });
    expect(created).toEqual({
      id: 302,
      summary: "Created from VS Code",
      build: "2026.04-phase3",
      planId: 100,
      manager: "admin"
    });
    expect(session.calls).toContainEqual({
      method: "TestRun.create",
      params: [
        {
          summary: "Created from VS Code",
          plan: 100,
          build: 10,
          manager: "admin"
        }
      ]
    });

    await adapter.addCaseToRun(config, 302, 501);
    expect(session.calls).toContainEqual({
      method: "TestRun.add_case",
      params: [302, 501]
    });
  });

  it("maps XML-RPC faults into KiwiError codes", () => {
    expect(
      toKiwiError({ faultCode: -32603, faultString: "Internal error: Wrong username or password" })
    ).toMatchObject({
      code: "AuthenticationFailed"
    });
    expect(
      toKiwiError({
        faultCode: -32603,
        faultString: "matching query does not exist"
      })
    ).toMatchObject({
      code: "NotFound"
    });
  });

  it("reuses sessions for the same resolved config", async () => {
    const sessions: FakeSession[] = [];
    const adapter = new RealKiwiAdapter(() => {
      const session = new FakeSession({
        "TestCase.filter": [
          [
            {
              id: 501,
              summary: "Login works",
              text: "# Existing body\n\n1. Open page"
            }
          ]
        ],
        "TestCase.history": [
          [
            {
              history_id: 10,
              history_date: "2026-04-05T00:00:00.000Z"
            }
          ]
        ]
      });
      sessions.push(session);
      return session;
    });

    await adapter.getCaseBody(config, 501, 100);
    await adapter.getCaseHistory(config, 501);

    expect(sessions).toHaveLength(1);
  });

  it("does not expose the password in credential cache keys", () => {
    const key = createCredentialCacheKey({
      baseUrl: "https://localhost:8443",
      username: "admin",
      password: "super-secret-password"
    });

    expect(key).toContain("https://localhost:8443");
    expect(key).toContain("admin");
    expect(key).toContain("sha256:");
    expect(key).not.toContain("super-secret-password");
  });

  it("does not reuse sessions across password changes", async () => {
    const sessions: FakeSession[] = [];
    const adapter = new RealKiwiAdapter(() => {
      const session = new FakeSession({
        "TestCase.filter": [
          [
            {
              id: 501,
              summary: "Login works",
              text: "# Existing body\n\n1. Open page"
            }
          ]
        ]
      });
      sessions.push(session);
      return session;
    });

    await adapter.getCaseBody({ ...config, password: "first-password" }, 501, 100);
    await adapter.getCaseBody({ ...config, password: "second-password" }, 501, 100);

    expect(sessions).toHaveLength(2);
  });

  it("invalidates cached sessions after connection failures", async () => {
    const firstSession = new FakeSession({
      "TestCase.filter": [new Error("socket hang up")]
    });
    const secondSession = new FakeSession({
      "TestCase.filter": [
        [
          {
            id: 501,
            summary: "Login works",
            text: "# Existing body\n\n1. Open page"
          }
        ]
      ]
    });
    const queue = [firstSession, secondSession];
    const adapter = new RealKiwiAdapter(() => queue.shift()!);

    await expect(adapter.getCaseBody(config, 501, 100)).rejects.toMatchObject({
      code: "ConnectionFailed"
    });
    await adapter.getCaseBody(config, 501, 100);

    expect(queue).toHaveLength(0);
  });

  it("derives attachment filenames from urls", () => {
    expect(
      filenameFromUrl("https://localhost:8443/uploads/attachments/testcases_testcase/1/file%20name.png")
    ).toBe("file name.png");
  });

  it("derives attachment filenames from content-disposition", () => {
    expect(
      parseContentDispositionFilename("attachment; filename*=UTF-8''ChatGPT%E9%80%A3%E5%8B%95%E6%96%B9%E6%B3%95.md")
    ).toBe("ChatGPT連動方法.md");
    expect(
      parseContentDispositionFilename('attachment; filename="diagram.png"')
    ).toBe("diagram.png");
  });
});

class FakeSession {
  readonly calls: Array<{ method: string; params: unknown[] }> = [];

  constructor(private readonly responses: Record<string, unknown[]>) {}

  async call(method: string, params: unknown[]): Promise<unknown> {
    this.calls.push({ method, params });
    const queue = this.responses[method];
    if (!queue || queue.length === 0) {
      throw new KiwiError("ApiUnsupported", `Missing fake response for ${method}.`);
    }

    const next = queue.shift();
    if (next instanceof Error) {
      throw next;
    }

    return next;
  }
}
