import * as vscode from "vscode";
import { KiwiAdapter } from "../adapter/types";
import { deriveVersionToken } from "../domain/versionToken";
import { CaseDocumentSessionMetadata, KiwiConfig } from "../types";

type KiwiClient = {
  adapter: KiwiAdapter;
  config: KiwiConfig;
};

export type CaseFreshnessStatus = "fresh" | "stale" | "unknown";

export type CaseFreshnessResult = {
  status: CaseFreshnessStatus;
  caseId: number;
  planId: number;
  localVersionToken?: string;
  remoteVersionToken?: string;
  reason?: string;
};

type CaseDocumentSessionReader = {
  getCaseDocumentSession(uri: vscode.Uri): CaseDocumentSessionMetadata | undefined;
};

export class CaseFreshnessService {
  constructor(
    private readonly clientFactory: () => Promise<KiwiClient>,
    private readonly sessionReader: CaseDocumentSessionReader
  ) {}

  async checkUri(uri: vscode.Uri): Promise<CaseFreshnessResult> {
    const session = this.sessionReader.getCaseDocumentSession(uri);
    if (!session) {
      return {
        status: "unknown",
        caseId: 0,
        planId: 0,
        reason: "Open the Case Document before checking the latest state."
      };
    }
    return this.checkSession(session);
  }

  async checkSession(session: CaseDocumentSessionMetadata): Promise<CaseFreshnessResult> {
    try {
      const { adapter, config } = await this.clientFactory();
      const history = await adapter.getCaseHistory(config, session.caseId);
      if (history.length === 0) {
        return {
          status: "unknown",
          caseId: session.caseId,
          planId: session.planId,
          localVersionToken: session.versionToken,
          reason: "Could not determine the latest state because remote history is empty."
        };
      }

      const remoteVersionToken = deriveVersionToken(history);
      return {
        status: session.versionToken === remoteVersionToken ? "fresh" : "stale",
        caseId: session.caseId,
        planId: session.planId,
        localVersionToken: session.versionToken,
        remoteVersionToken
      };
    } catch (error) {
      return {
        status: "unknown",
        caseId: session.caseId,
        planId: session.planId,
        localVersionToken: session.versionToken,
        reason: error instanceof Error ? error.message : String(error)
      };
    }
  }
}
