import { describe, it, expect } from "vitest";
import { reAnchorAnnotation, type ReAnchorResult } from "@/lib/specs/annotations";
import { parseSpecSections, hashParagraph } from "@/lib/specs/parse";
import type { Annotation } from "@/lib/types";

function makeAnnotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: "anno_1",
    projectId: "proj_1",
    sectionHeading: "In flight",
    paragraphIndex: 0,
    paragraphHash: hashParagraph("original text"),
    body: "note",
    status: "open",
    createdAt: "2026-05-14T00:00:00Z",
    resolvedAt: null,
    orphanedAt: null,
    driftedAt: null,
    resolvedBy: null,
    ...overrides,
  };
}

describe("reAnchorAnnotation", () => {
  it("keeps the anchor when section+index+hash all match", () => {
    const md = "## In flight\n\noriginal text\n\nother para";
    const sections = parseSpecSections(md);
    const ann = makeAnnotation();
    const result = reAnchorAnnotation(ann, sections);
    expect(result.kind).toBe("kept");
    if (result.kind === "kept") {
      expect(result.annotation.paragraphIndex).toBe(0);
      expect(result.annotation.paragraphHash).toBe(ann.paragraphHash);
      expect(result.annotation.status).toBe("open");
    }
  });

  it("returns 'drifted' when section+index match but the paragraph text changed (and original hash is gone)", () => {
    const md = "## In flight\n\nnew text\n\nother para";
    const sections = parseSpecSections(md);
    const ann = makeAnnotation();
    const result = reAnchorAnnotation(ann, sections);
    expect(result.kind).toBe("drifted");
    if (result.kind === "drifted") {
      expect(result.annotation.paragraphIndex).toBe(0);
      expect(result.annotation.paragraphHash).toBe(hashParagraph("new text"));
      expect(result.annotation.status).toBe("open");
      expect(result.annotation.driftedAt).not.toBeNull();
    }
  });

  it("updates the index when the paragraph moved within the section (hash match)", () => {
    const md = "## In flight\n\nintro\n\noriginal text\n\nother para";
    const sections = parseSpecSections(md);
    const ann = makeAnnotation({ paragraphIndex: 0 });
    const result = reAnchorAnnotation(ann, sections);
    expect(result.kind).toBe("kept");
    if (result.kind === "kept") {
      expect(result.annotation.paragraphIndex).toBe(1);
      expect(result.annotation.paragraphHash).toBe(hashParagraph("original text"));
    }
  });

  it("orphans the annotation when the section is gone", () => {
    const md = "## Different section\n\nstuff";
    const sections = parseSpecSections(md);
    const ann = makeAnnotation();
    const result = reAnchorAnnotation(ann, sections);
    expect(result.kind).toBe("orphaned");
    if (result.kind === "orphaned") {
      expect(result.annotation.status).toBe("orphaned");
      expect(result.annotation.orphanedAt).not.toBeNull();
    }
  });

  it("orphans when section exists but no paragraph matches by index or hash", () => {
    const md = "## In flight\n\ncompletely different\n\nalso different";
    const sections = parseSpecSections(md);
    const ann = makeAnnotation({ paragraphIndex: 5 });
    const result = reAnchorAnnotation(ann, sections);
    expect(result.kind).toBe("orphaned");
  });

  it("preserves the annotation's own metadata fields (body, createdAt, id) when kept", () => {
    const md = "## In flight\n\noriginal text";
    const sections = parseSpecSections(md);
    const ann = makeAnnotation({ body: "important note", id: "anno_xyz" });
    const result = reAnchorAnnotation(ann, sections);
    expect(result.kind).toBe("kept");
    if (result.kind === "kept") {
      expect(result.annotation.body).toBe("important note");
      expect(result.annotation.id).toBe("anno_xyz");
    }
  });

  it("leaves resolved annotations untouched", () => {
    const md = "## Different\n\nstuff";
    const sections = parseSpecSections(md);
    const ann = makeAnnotation({ status: "resolved", resolvedAt: "2026-05-14T00:00:00Z", resolvedBy: "user" });
    const result = reAnchorAnnotation(ann, sections);
    expect(result.kind).toBe("kept");
    if (result.kind === "kept") {
      expect(result.annotation.status).toBe("resolved");
    }
  });

  it("returns 'drifted' when the section+index still resolve but the original hash is gone", () => {
    // Original paragraph hash is for "original text" — but the spec now has "completely different" at index 0
    // and no paragraph matches the original hash anywhere in the section.
    const md = "## In flight\n\ncompletely different\n\nalso unrelated";
    const sections = parseSpecSections(md);
    const ann = makeAnnotation({ paragraphIndex: 0 });
    const result: ReAnchorResult = reAnchorAnnotation(ann, sections);
    expect(result.kind).toBe("drifted");
    if (result.kind === "drifted") {
      expect(result.annotation.status).toBe("open");
      expect(result.annotation.paragraphIndex).toBe(0);
      expect(result.annotation.paragraphHash).toBe(hashParagraph("completely different"));
      expect(result.annotation.driftedAt).not.toBeNull();
    }
  });

  it("does not mark drifted when the original hash is found elsewhere in the section", () => {
    // Original moved to index 1; should be a clean "kept" with updated index, not drifted.
    const md = "## In flight\n\nintro\n\noriginal text";
    const sections = parseSpecSections(md);
    const ann = makeAnnotation({ paragraphIndex: 0 });
    const result = reAnchorAnnotation(ann, sections);
    expect(result.kind).toBe("kept");
    if (result.kind === "kept") {
      expect(result.annotation.driftedAt).toBeNull();
    }
  });

  it("preserves a previously-set driftedAt when the anchor is unchanged", () => {
    const md = "## In flight\n\noriginal text";
    const sections = parseSpecSections(md);
    const ann = makeAnnotation({ driftedAt: "2026-05-13T00:00:00Z" });
    const result = reAnchorAnnotation(ann, sections);
    expect(result.kind).toBe("kept");
    if (result.kind === "kept") {
      expect(result.annotation.driftedAt).toBe("2026-05-13T00:00:00Z");
    }
  });
});
