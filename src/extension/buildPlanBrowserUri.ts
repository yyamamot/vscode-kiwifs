export function buildPlanBrowserUri(baseUrl: string, planId: number): string {
  return new URL(`/plan/${planId}/`, baseUrl).toString();
}
