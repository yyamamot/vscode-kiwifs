export function toDisplayUrl(url: string): string {
  try {
    return decodeURIComponent(url);
  } catch {
    return url;
  }
}
