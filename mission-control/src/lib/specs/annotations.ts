import type { ParsedSection } from "@/lib/specs/parse";
import type { Annotation } from "@/lib/types";

export type ReAnchorResult =
  | { kind: "kept"; annotation: Annotation }
  | { kind: "drifted"; annotation: Annotation }
  | { kind: "orphaned"; annotation: Annotation };

export function reAnchorAnnotation(
  annotation: Annotation,
  sections: ParsedSection[],
  now: () => string = () => new Date().toISOString()
): ReAnchorResult {
  // Resolved and already-orphaned annotations are not re-anchored.
  if (annotation.status !== "open") {
    return { kind: "kept", annotation };
  }

  const section = sections.find((s) => s.heading === annotation.sectionHeading);
  if (!section) {
    return {
      kind: "orphaned",
      annotation: { ...annotation, status: "orphaned", orphanedAt: now() },
    };
  }

  const atIndex = section.paragraphs[annotation.paragraphIndex];

  // 1. Hash matches at the stored index — completely unchanged. Preserve everything.
  if (atIndex && atIndex.hash === annotation.paragraphHash) {
    return { kind: "kept", annotation };
  }

  // 2. Hash matches some other paragraph in the section — clean move, update the index.
  const byHash = section.paragraphs.find((p) => p.hash === annotation.paragraphHash);
  if (byHash) {
    return {
      kind: "kept",
      annotation: { ...annotation, paragraphIndex: byHash.index },
    };
  }

  // 3. Paragraph still exists at the stored index but content changed AND original hash is gone.
  //    The annotation drifted — silently re-anchor BUT flag it for user review.
  if (atIndex) {
    return {
      kind: "drifted",
      annotation: { ...annotation, paragraphHash: atIndex.hash, driftedAt: now() },
    };
  }

  return {
    kind: "orphaned",
    annotation: { ...annotation, status: "orphaned", orphanedAt: now() },
  };
}
