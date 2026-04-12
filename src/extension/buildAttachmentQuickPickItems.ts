import { KiwiCaseAttachment } from "../types";
import { toDisplayUrl } from "./displayUrl";

export type AttachmentQuickPickItem = {
  label: string;
  description?: string;
  detail?: string;
  attachment: KiwiCaseAttachment;
};

export function buildAttachmentQuickPickItems(
  attachments: KiwiCaseAttachment[]
): AttachmentQuickPickItem[] {
  return attachments
    .filter((attachment) => Boolean(attachment.downloadUrl?.trim()))
    .sort((left, right) => left.filename.localeCompare(right.filename))
    .map((attachment) => ({
      label: attachment.filename,
      description:
        attachment.size !== undefined ? `${attachment.size} bytes` : undefined,
      detail: attachment.downloadUrl ? toDisplayUrl(attachment.downloadUrl) : undefined,
      attachment
    }));
}
