import { learningDocumentToMarkdown, type LearningDocument } from "@immersive/core";

/** Native Host and extension downloads intentionally share the same canonical Markdown export. */
export function toMarkdown(doc: LearningDocument): string {
  return learningDocumentToMarkdown(doc);
}
