import { KiwiCaseAttachmentContent } from "../types";

const TEXT_EXTENSIONS: Record<string, string> = {
  ".md": "markdown",
  ".markdown": "markdown",
  ".txt": "plaintext",
  ".json": "json",
  ".yml": "yaml",
  ".yaml": "yaml",
  ".xml": "xml",
  ".csv": "csv"
};

const PREVIEW_IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"]);
const PREVIEW_PDF_EXTENSIONS = new Set([".pdf"]);

const PREVIEW_IMAGE_CONTENT_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml"
]);

const PREVIEW_PDF_CONTENT_TYPES = new Set(["application/pdf"]);

const TEXT_CONTENT_TYPES = new Set([
  "application/json",
  "application/ld+json",
  "application/xml",
  "application/yaml",
  "application/x-yaml",
  "text/markdown"
]);

export type AttachmentEditorViewKind =
  | "text"
  | "preview-image"
  | "preview-pdf"
  | "unsupported";

export function inferAttachmentLanguage(filename: string): string {
  const normalized = filename.toLowerCase();
  const matched = Object.entries(TEXT_EXTENSIONS).find(([extension]) =>
    normalized.endsWith(extension)
  );
  return matched?.[1] ?? "plaintext";
}

export function classifyAttachmentEditorView(
  content: KiwiCaseAttachmentContent,
  filename: string
): AttachmentEditorViewKind {
  const contentType = content.contentType?.toLowerCase().split(";")[0].trim();
  const extension = fileExtension(filename);

  if (PREVIEW_IMAGE_EXTENSIONS.has(extension)) {
    return "preview-image";
  }
  if (PREVIEW_PDF_EXTENSIONS.has(extension)) {
    return "preview-pdf";
  }
  if (isTextExtension(filename)) {
    return "text";
  }

  if (!contentType) {
    return "unsupported";
  }

  if (contentType.startsWith("text/")) {
    return "text";
  }

  if (TEXT_CONTENT_TYPES.has(contentType)) {
    return "text";
  }

  if (PREVIEW_IMAGE_CONTENT_TYPES.has(contentType)) {
    return "preview-image";
  }

  if (PREVIEW_PDF_CONTENT_TYPES.has(contentType)) {
    return "preview-pdf";
  }

  return "unsupported";
}

function isTextExtension(filename: string): boolean {
  return Object.keys(TEXT_EXTENSIONS).some((extension) =>
    filename.toLowerCase().endsWith(extension)
  );
}

function fileExtension(filename: string): string {
  const normalized = filename.toLowerCase();
  const dotIndex = normalized.lastIndexOf(".");
  return dotIndex >= 0 ? normalized.slice(dotIndex) : "";
}
