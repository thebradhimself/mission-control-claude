import { NextResponse } from "next/server";
import { z } from "zod";
import { regenSpecForProjectId, ProjectNotFoundError } from "@/lib/specs/regen-runner";

const bodySchema = z.object({
  projectId: z.string().min(1),
  reason: z.enum(["manual", "cron", "event", "stale-view"]).optional().default("manual"),
});

export async function POST(req: Request) {
  let parsed;
  try {
    parsed = bodySchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json({ error: "Invalid request body", detail: String(err) }, { status: 400 });
  }

  try {
    const result = await regenSpecForProjectId(parsed.projectId, parsed.reason);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ProjectNotFoundError) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    return NextResponse.json({ error: "Spec regen failed", detail: String(err) }, { status: 500 });
  }
}
