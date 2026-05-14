import { NextResponse } from "next/server";
import { annotationUpdateSchema } from "@/lib/validations";
import { updateAnnotation, removeAnnotation } from "@/lib/annotations/storage";
import type { Annotation } from "@/lib/types";

type UpdatePatch = Partial<Pick<Annotation, "body" | "status" | "resolvedAt" | "orphanedAt" | "resolvedBy">>;

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
