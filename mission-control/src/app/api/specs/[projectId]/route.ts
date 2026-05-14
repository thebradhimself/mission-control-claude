import { NextResponse } from "next/server";
import { readSpec } from "@/lib/specs/storage";

export async function GET(_req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (!projectId || typeof projectId !== "string") {
    return NextResponse.json({ error: "Invalid projectId" }, { status: 400 });
  }
  const record = await readSpec(projectId);
  if (!record) {
    return NextResponse.json({ markdown: null, meta: null }, { status: 200 });
  }
  return NextResponse.json(record);
}
