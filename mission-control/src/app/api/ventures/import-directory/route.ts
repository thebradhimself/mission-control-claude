import { NextResponse } from "next/server";
import { z } from "zod";
import { analyzeProjectDirectory } from "@/lib/project-directory-scanner";
import { mutateProjects, mutateTasks } from "@/lib/data";
import type { Project, Task } from "@/lib/types";
import { generateId } from "@/lib/utils";

const importDirectorySchema = z.object({
  directory: z.string().min(1, "Directory is required").max(1000),
  color: z.string().max(20).optional().default("#06b6d4"),
  createTasks: z.boolean().optional().default(true),
});

export async function POST(request: Request) {
  let body: z.infer<typeof importDirectorySchema>;
  try {
    body = importDirectorySchema.parse(await request.json());
  } catch (error) {
    return NextResponse.json(
      { error: "Invalid request", details: error instanceof Error ? error.message : "Unknown validation error" },
      { status: 400 },
    );
  }

  try {
    const imported = await analyzeProjectDirectory(body.directory);
    const createdAt = new Date().toISOString();

    const project = await mutateProjects(async (data) => {
      const newProject: Project = {
        id: generateId("proj"),
        name: imported.name,
        description: imported.description,
        status: "active",
        color: body.color,
        teamMembers: imported.teamMembers,
        createdAt,
        tags: imported.tags,
        sourceDirectory: imported.analysis.sourceDirectory,
        analysis: imported.analysis,
        deletedAt: null,
      };
      data.projects.push(newProject);
      return newProject;
    });

    let tasks: Task[] = [];
    if (body.createTasks && imported.analysis.recommendations.length > 0) {
      tasks = await mutateTasks(async (data) => {
        const generated = imported.analysis.recommendations.slice(0, 8).map((recommendation, index): Task => ({
          id: generateId("task"),
          title: toTaskTitle(recommendation),
          description: [
            recommendation,
            "",
            `Generated from the directory scan for ${project.name}.`,
            `Source directory: ${project.sourceDirectory}`,
          ].join("\n"),
          importance: index < 3 ? "important" : "not-important",
          urgency: index === 0 ? "urgent" : "not-urgent",
          kanban: "not-started",
          projectId: project.id,
          milestoneId: null,
          assignedTo: recommendation.match(/README|documentation|record|capture/i) ? "researcher" : "developer",
          collaborators: ["me"],
          dailyActions: [],
          subtasks: [],
          blockedBy: [],
          estimatedMinutes: index < 3 ? 60 : 30,
          actualMinutes: null,
          acceptanceCriteria: [
            "The recommendation has been investigated against the current codebase.",
            "Findings or implementation details are recorded in the task notes.",
            "Any resulting code or documentation changes have been verified locally.",
          ],
          fieldTaskIds: [],
          comments: [],
          tags: ["directory-scan", project.analysis?.developmentStage ?? "scan"],
          notes: "",
          dueDate: null,
          createdAt,
          updatedAt: createdAt,
          completedAt: null,
          deletedAt: null,
        }));
        data.tasks.push(...generated);
        return generated;
      });
    }

    return NextResponse.json({ project, tasks, analysis: imported.analysis }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to import directory", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 400 },
    );
  }
}

function toTaskTitle(recommendation: string): string {
  const trimmed = recommendation.replace(/\.$/, "");
  return trimmed.length <= 180 ? trimmed : `${trimmed.slice(0, 177)}...`;
}
