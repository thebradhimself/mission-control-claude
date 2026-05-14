import type { ParsedSection } from "@/lib/specs/parse";
import type { Annotation } from "@/lib/types";

export type ReAnchorResult =
  | { kind: "kept"; annotation: Annotation }
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

  // If the paragraph at the stored index has the exact same hash, it's unchanged — keep as-is.
  if (atIndex && atIndex.hash === annotation.paragraphHash) {
    return { kind: "kept", annotation };
  }

  // Try to find the original paragraph by hash (it may have moved within the section).
  const byHash = section.paragraphs.find((p) => p.hash === annotation.paragraphHash);
  if (byHash) {
    return {
      kind: "kept",
      annotation: { ...annotation, paragraphIndex: byHash.index },
    };
  }

  // The paragraph at the stored index exists but with different content — update the hash.
  if (atIndex) {
    return {
      kind: "kept",
      annotation: { ...annotation, paragraphHash: atIndex.hash },
    };
  }

  return {
    kind: "orphaned",
    annotation: { ...annotation, status: "orphaned", orphanedAt: now() },
  };
}
