type CaseDiffDocumentInput = {
  body: string;
};

export function renderCaseDiffDocument(input: CaseDiffDocumentInput): string {
  return input.body;
}

export function renderCaseDiffTitle(summary: string): string {
  return `${summary} (Local ↔ Remote)`;
}
