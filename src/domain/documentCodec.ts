import { CaseDocumentData, KiwiCase, KiwiCaseBody } from "../types";

export function renderCaseDocument(data: CaseDocumentData): string {
  return normalizeBody(data.body);
}

export function parseCaseDocument(content: string): CaseDocumentData {
  return {
    body: normalizeBody(content)
  };
}

export function toCaseDocumentData(remoteCase: KiwiCase | KiwiCaseBody): CaseDocumentData {
  return {
    body: normalizeBody(remoteCase.text)
  };
}

function normalizeBody(content: string): string {
  return content.replace(/\r\n/g, "\n");
}
