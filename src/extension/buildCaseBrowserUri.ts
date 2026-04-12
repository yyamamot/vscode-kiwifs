export function buildCaseBrowserUri(baseUrl: string, caseId: number): string {
  return new URL(`/case/${caseId}/`, baseUrl).toString();
}
