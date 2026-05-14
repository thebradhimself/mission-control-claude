import { NextResponse } from "next/server";
import { clearThread, readThread } from "@/lib/ai/threads";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  if (!projectId) {
    return NextResponse.json({ error: "Invalid projectId" }, { status: 400 });
  }
  const thread = await readThread(projectId);
  return NextResponse.json({ thread });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  if (!projectId) {
    return NextResponse.json({ error: "Invalid projectId" }, { status: 400 });
  }
  const removed = await clearThread(projectId);
  return NextResponse.json({ removed });
}
