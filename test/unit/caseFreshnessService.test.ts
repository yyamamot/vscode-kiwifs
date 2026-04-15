import { describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({
  Uri: {
    parse: (value: string) => ({ toString: () => value })
  }
}));

import * as vscode from "vscode";
import { CaseFreshnessService } from "../../src/extension/caseFreshnessService";
import { KiwiAdapter } from "../../src/adapter/types";

function createService(args: {
  localVersionToken?: string;
  history?: Awaited<ReturnType<KiwiAdapter["getCaseHistory"]>>;
  throws?: Error;
}): CaseFreshnessService {
  const adapter = {
    getCaseHistory: vi.fn(async () => {
      if (args.throws) {
        throw args.throws;
      }
      return args.history ?? [
        {
          historyId: 2,
          historyDate: "2026-04-12T00:00:00.000Z"
        }
      ];
    })
  } as unknown as KiwiAdapter;

  return new CaseFreshnessService(
    async () => ({ adapter, config: { baseUrl: "https://kiwi.example", username: "u", password: "p" } }),
    {
      getCaseDocumentSession: () =>
        args.localVersionToken
          ? {
              caseId: 501,
              planId: 100,
              versionToken: args.localVersionToken
            }
          : undefined
    }
  );
}

describe("CaseFreshnessService", () => {
  it("returns fresh when local and remote version tokens match", async () => {
    const service = createService({
      localVersionToken: "history_id:2",
      history: [{ historyId: 2, historyDate: "2026-04-12T00:00:00.000Z" }]
    });

    await expect(service.checkUri(vscode.Uri.parse("kiwi:/plans/100/cases/501.md"))).resolves.toMatchObject({
      status: "fresh",
      caseId: 501,
      planId: 100,
      remoteVersionToken: "history_id:2"
    });
  });

  it("returns stale when remote version token changed", async () => {
    const service = createService({
      localVersionToken: "1:2026-04-11T00:00:00.000Z",
      history: [{ historyId: 2, historyDate: "2026-04-12T00:00:00.000Z" }]
    });

    await expect(service.checkUri(vscode.Uri.parse("kiwi:/plans/100/cases/501.md"))).resolves.toMatchObject({
      status: "stale",
      localVersionToken: "1:2026-04-11T00:00:00.000Z",
      remoteVersionToken: "history_id:2"
    });
  });

  it("returns unknown when session cache is missing", async () => {
    const service = createService({});

    await expect(service.checkUri(vscode.Uri.parse("kiwi:/plans/100/cases/501.md"))).resolves.toMatchObject({
      status: "unknown",
      reason: "Case Document を開いてから最新状態を確認してください。"
    });
  });

  it("returns unknown when history cannot be fetched", async () => {
    const service = createService({
      localVersionToken: "1:2026-04-11T00:00:00.000Z",
      throws: new Error("network down")
    });

    await expect(service.checkUri(vscode.Uri.parse("kiwi:/plans/100/cases/501.md"))).resolves.toMatchObject({
      status: "unknown",
      reason: "network down"
    });
  });
});
