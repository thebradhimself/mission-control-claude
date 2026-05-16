import { NextResponse } from "next/server";
import { annotationUpdateSchema } from "@/lib/validations";
import { updateAnnotation, removeAnnotation, readAnnotations } from "@/lib/annotations/storage";
import { readSpec } from "@/lib/specs/storage";
import { parseSpecSections } from "@/lib/specs/parse";
import type { Annotation } from "@/lib/types";

type UpdatePatch = Partial<Pick<
  Annotation,
  "body" | "status" | "sectionHeading" | "paragraphIndex" | "paragraphHash"
  | "resolvedAt" | "orphanedAt" | "driftedAt" | "resolvedBy"
>>;

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let parsed;
  try {
    parsed = annotationUpdateSchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json({ error: "Invalid request body", detail: String(err) }, { status: 400 });
  }

  const now = new Date().toISOString();
  const patch: UpdatePatch = {};

  if (parsed.body !== undefined) patch.body = parsed.body;

  if (parsed.status !== undefined) {
    patch.status = parsed.status;
    if (parsed.status === "resolved") {
      patch.resolvedAt = now;
      patch.resolvedBy = "user";
    } else if (parsed.status === "open") {
      patch.resolvedAt = null;
      patch.resolvedBy = null;
      patch.orphanedAt = null;
    }
  }

  if (parsed.ackDrift) {
    patch.driftedAt = null;
  }

  // Re-anchor: section+index → recompute hash from current spec
  if (parsed.sectionHeading !== undefined && parsed.paragraphIndex !== undefined) {
    const annotations = await readAnnotations();
    const target = annotations.find((a) => a.id === id);
    if (!target) {
      return NextResponse.json({ error: "Annotation not found" }, { status: 404 });
    }
    const spec = await readSpec(target.projectId);
    if (!spec) {
      return NextResponse.json({ error: "Spec not found for project" }, { status: 404 });
    }
    const sections = parseSpecSections(spec.markdown);
    const section = sections.find((s) => s.heading === parsed.sectionHeading);
    if (!section) {
      return NextResponse.json({ error: "Section not found in spec" }, { status: 404 });
    }
    const paragraph = section.paragraphs[parsed.paragraphIndex];
    if (!paragraph) {
      return NextResponse.json({ error: "Paragraph not found at index" }, { status: 404 });
    }
    patch.sectionHeading = parsed.sectionHeading;
    patch.paragraphIndex = parsed.paragraphIndex;
    patch.paragraphHash = paragraph.hash;
    // Re-anchoring an orphan or drifted annotation reopens it cleanly.
    patch.status = "open";
    patch.orphanedAt = null;
    patch.driftedAt = null;
    patch.resolvedAt = null;
    patch.resolvedBy = null;
  }

  const updated = await updateAnnotation(id, patch);
  if (!updated) {
    return NextResponse.json({ error: "Annotation not found" }, { status: 404 });
  }
  return NextResponse.json(updated);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ok = await removeAnnotation(id);
  if (!ok) {
    return NextResponse.json({ error: "Annotation not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
