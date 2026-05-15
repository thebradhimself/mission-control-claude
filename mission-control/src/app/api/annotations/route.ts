import { NextResponse } from "next/server";
import { annotationCreateSchema } from "@/lib/validations";
import { readAnnotations, addAnnotation } from "@/lib/annotations/storage";
import { readSpec } from "@/lib/specs/storage";
import { parseSpecSections } from "@/lib/specs/parse";
import type { Annotation } from "@/lib/types";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const projectId = url.searchParams.get("projectId");
  const list = await readAnnotations();
  const filtered = projectId ? list.filter((a) => a.projectId === projectId) : list;
  return NextResponse.json({ annotations: filtered });
}

export async function POST(req: Request) {
  let parsed;
  try {
    parsed = annotationCreateSchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json({ error: "Invalid request body", detail: String(err) }, { status: 400 });
  }

  const spec = await readSpec(parsed.projectId);
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

  const annotation: Annotation = {
    id: `anno_${Date.now()}`,
    projectId: parsed.projectId,
    sectionHeading: parsed.sectionHeading,
    paragraphIndex: parsed.paragraphIndex,
    paragraphHash: paragraph.hash,
    body: parsed.body,
    status: "open",
    createdAt: new Date().toISOString(),
    resolvedAt: null,
    orphanedAt: null,
    driftedAt: null,
    resolvedBy: null,
  };

  await addAnnotation(annotation);
  return NextResponse.json(annotation, { status: 201 });
}
