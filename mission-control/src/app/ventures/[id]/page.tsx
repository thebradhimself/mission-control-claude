"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  closestCenter,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { AlertTriangle, CheckCircle2, FileSearch, Plus, Terminal } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { BreadcrumbNav } from "@/components/breadcrumb-nav";
import { TaskCard } from "@/components/task-card";
import { TaskDetailPanel } from "@/components/task-detail-panel";
import { CreateTaskDialog } from "@/components/create-task-dialog";
import { GoalCard } from "@/components/goal-card";
import { useTasks, useGoals, useProjects, useAgents, useDecisions } from "@/hooks/use-data";
import { useActiveRunsContext as useActiveRuns } from "@/providers/active-runs-provider";
import { useFastTaskPoll } from "@/hooks/use-fast-task-poll";
import type { Task, EisenhowerQuadrant, KanbanStatus } from "@/lib/types";
import { getQuadrant, valuesFromQuadrant } from "@/lib/types";
import type { TaskFormData } from "@/components/task-form";
import { getAgentIcon } from "@/lib/agent-icons";
import { cn } from "@/lib/utils";
import { Users, X } from "lucide-react";
import { RunButton } from "@/components/run-button";
import { ProjectRunProgress } from "@/components/mission-progress";
import { LivingSpec } from "@/components/living-spec";

function DraggableTask({ task, onClick, isRunning, onRun, pendingDecisionTaskIds }: { task: Task; onClick: () => void; isRunning?: boolean; onRun?: (taskId: string) => void; pendingDecisionTaskIds?: Set<string> }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: task.id });
  const style = transform ? { transform: `translate(${transform.x}px, ${transform.y}px)` } : undefined;
  return (
    <div ref={setNodeRef} style={style} {...listeners} {...attributes}>
      <TaskCard task={task} isDragging={isDragging} onClick={onClick} isRunning={isRunning} onRun={onRun} pendingDecisionTaskIds={pendingDecisionTaskIds} />
    </div>
  );
}

function DroppableZone({ id, label, dotColor, tasks, onTaskClick, children, isTaskRunning, onRunTask, pendingDecisionTaskIds }: {
  id: string; label: string; dotColor: string; tasks: Task[]; onTaskClick: (t: Task) => void; children?: React.ReactNode;
  isTaskRunning?: (taskId: string) => boolean; onRunTask?: (taskId: string) => void; pendingDecisionTaskIds?: Set<string>;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={cn("flex flex-col rounded-xl border bg-card/50 min-h-[200px] transition-all", isOver && "ring-2 ring-primary/50")}>
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <div className="flex items-center gap-2">
          <div className={cn("h-2 w-2 rounded-full", dotColor)} />
          <span className="text-xs font-semibold">{label}</span>
        </div>
        <Badge variant="secondary" className="text-xs tabular-nums h-5 min-w-[1.25rem] justify-center">{tasks.length}</Badge>
      </div>
      <div className="flex-1 space-y-2 p-2 overflow-y-auto max-h-[60vh]">
        {tasks.length === 0 && <p className="py-6 text-center text-xs text-muted-foreground/40">Drop tasks here</p>}
        {tasks.map((t) => <DraggableTask key={t.id} task={t} onClick={() => onTaskClick(t)} isRunning={isTaskRunning?.(t.id)} onRun={onRunTask} pendingDecisionTaskIds={pendingDecisionTaskIds} />)}
        {children}
      </div>
    </div>
  );
}

export default function ProjectDetailPage() {
  const params = useParams();
  const projectId = params.id as string;

  const { tasks, update: updateTask, create: createTask, remove: deleteTask, refetch } = useTasks();
  const { goals } = useGoals();
  const { projects, update: updateProject } = useProjects();
  const { agents } = useAgents();
  const { decisions } = useDecisions();
  const { runs, runningTaskIds, isTaskRunning, runTask, isProjectRunning, isProjectRunActive, getProjectRun, runProject, stopProject } = useActiveRuns();
  const pendingDecisionTaskIds = new Set(
    decisions.filter((d) => d.status === "pending" && d.taskId).map((d) => d.taskId as string)
  );
  useFastTaskPoll(runningTaskIds.size > 0, refetch);

  // Require 8px of movement before starting a drag — allows clicks to pass through
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [showCreateTask, setShowCreateTask] = useState(false);

  const project = projects.find((p) => p.id === projectId);
  const projectTasks = tasks.filter((t) => t.projectId === projectId);
  const projectGoals = goals.filter((g) => g.projectId === projectId);
  const longTermGoals = projectGoals.filter((g) => g.type === "long-term");
  const milestones = projectGoals.filter((g) => g.type === "medium-term");

  if (!project) {
    return (
      <div className="space-y-4">
        <BreadcrumbNav items={[{ label: "Ventures", href: "/ventures" }, { label: "Not Found" }]} />
        <p className="text-muted-foreground">Project not found.</p>
      </div>
    );
  }

  // Eisenhower groups (exclude done)
  const eActive = projectTasks.filter((t) => t.kanban !== "done");
  const eGrouped: Record<EisenhowerQuadrant, Task[]> = { do: [], schedule: [], delegate: [], eliminate: [] };
  eActive.forEach((t) => { eGrouped[getQuadrant(t)].push(t); });

  // Kanban groups
  const kGrouped: Record<KanbanStatus, Task[]> = { "not-started": [], "in-progress": [], done: [] };
  projectTasks.forEach((t) => { kGrouped[t.kanban].push(t); });

  const progress = projectTasks.length > 0
    ? Math.round((projectTasks.filter((t) => t.kanban === "done").length / projectTasks.length) * 100)
    : 0;

  function handleDragStart(event: DragStartEvent) {
    setActiveTask(tasks.find((t) => t.id === event.active.id) ?? null);
  }

  async function handleEisenhowerDragEnd(event: DragEndEvent) {
    setActiveTask(null);
    const { active, over } = event;
    if (!over) return;
    const task = tasks.find((t) => t.id === active.id);
    if (!task) return;
    const targetQ = over.id as EisenhowerQuadrant;
    if (getQuadrant(task) === targetQ) return;
    const { importance, urgency } = valuesFromQuadrant(targetQ);
    await updateTask(task.id, { importance, urgency });
  }

  async function handleKanbanDragEnd(event: DragEndEvent) {
    setActiveTask(null);
    const { active, over } = event;
    if (!over) return;
    const task = tasks.find((t) => t.id === active.id);
    if (!task) return;
    const targetStatus = over.id as KanbanStatus;
    if (task.kanban === targetStatus) return;
    await updateTask(task.id, { kanban: targetStatus });
  }

  const handleUpdateTask = async (data: TaskFormData) => {
    if (!selectedTask) return;
    await updateTask(selectedTask.id, {
      ...data,
      tags: data.tags.split(",").map((t) => t.trim()).filter(Boolean),
      acceptanceCriteria: data.acceptanceCriteria.split("\n").map((s) => s.trim()).filter(Boolean),
    });
    setSelectedTask(null);
  };

  const handleCreateTask = async (data: TaskFormData) => {
    await createTask({
      id: `task_${Date.now()}`,
      ...data,
      dailyActions: [],
      tags: data.tags.split(",").map((t) => t.trim()).filter(Boolean),
      acceptanceCriteria: data.acceptanceCriteria.split("\n").map((s) => s.trim()).filter(Boolean),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null,
    });
  };

  return (
    <div className="space-y-4">
      <BreadcrumbNav items={[{ label: "Ventures", href: "/ventures" }, { label: project.name }]} />

      {/* Project Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-4 w-4 rounded-full" style={{ backgroundColor: project.color }} />
          <h1 className="text-xl font-bold">{project.name}</h1>
          <Badge variant="outline" className="text-xs capitalize">{project.status}</Badge>
        </div>
        <div className="flex items-center gap-2">
          <RunButton
            isRunning={isProjectRunning(projectId)}
            isProjectRunActive={isProjectRunActive(projectId)}
            onClick={() => runProject(projectId)}
            onStop={() => stopProject(projectId)}
            size="md"
            title={isProjectRunActive(projectId) ? "Project running — click to stop" : "Run all project tasks"}
          />
          <Button size="sm" onClick={() => setShowCreateTask(true)} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" /> Task
          </Button>
        </div>
      </div>
      {project.description && <p className="text-sm text-muted-foreground">{project.description}</p>}

      {/* Progress */}
      <div className="flex items-center gap-3">
        <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress}%` }} />
        </div>
        <span className="text-xs text-muted-foreground tabular-nums">{progress}% · {projectTasks.length} tasks</span>
      </div>

      {/* Project Run Progress */}
      {getProjectRun(projectId) && (
        <ProjectRunProgress
          projectRun={getProjectRun(projectId)!}
          runs={runs}
          onStop={() => stopProject(projectId)}
        />
      )}

      {/* Team Section */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Team</h2>
          <span className="text-xs text-muted-foreground">
            {(project.teamMembers ?? []).length} member{(project.teamMembers ?? []).length !== 1 ? "s" : ""}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {/* Current team members */}
          {(project.teamMembers ?? []).map((memberId) => {
            const agent = agents.find((a) => a.id === memberId);
            const MemberIcon = getAgentIcon(memberId, agent?.icon);
            return (
              <div
                key={memberId}
                className="flex items-center gap-1.5 rounded-lg border bg-card px-2.5 py-1.5 text-sm group"
              >
                <div className="h-5 w-5 rounded-full bg-primary/10 flex items-center justify-center">
                  <MemberIcon className="h-3 w-3 text-primary" />
                </div>
                <span className="text-xs font-medium">{agent?.name ?? memberId}</span>
                <button
                  onClick={async () => {
                    const newMembers = (project.teamMembers ?? []).filter((m) => m !== memberId);
                    await updateProject(project.id, { teamMembers: newMembers });
                  }}
                  className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity ml-0.5"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          })}
          {/* Add member buttons */}
          {agents
            .filter((a) => a.status === "active" && !(project.teamMembers ?? []).includes(a.id))
            .map((agent) => {
              const AgentIcon = getAgentIcon(agent.id, agent.icon);
              return (
                <button
                  key={agent.id}
                  onClick={async () => {
                    const newMembers = [...(project.teamMembers ?? []), agent.id];
                    await updateProject(project.id, { teamMembers: newMembers });
                  }}
                  className="flex items-center gap-1.5 rounded-lg border border-dashed px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                >
                  <AgentIcon className="h-3 w-3" />
                  <Plus className="h-2.5 w-2.5" />
                  {agent.name}
                </button>
              );
            })}
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="spec" className="space-y-4">
        <TabsList>
          <TabsTrigger value="spec">Spec</TabsTrigger>
          <TabsTrigger value="priority-matrix">Priority Matrix</TabsTrigger>
          <TabsTrigger value="status-board">Status Board</TabsTrigger>
          <TabsTrigger value="milestones">Milestones</TabsTrigger>
          {project.analysis && <TabsTrigger value="scan">Scan</TabsTrigger>}
        </TabsList>

        <TabsContent value="spec">
          <LivingSpec projectId={projectId} />
        </TabsContent>

        <TabsContent value="priority-matrix">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleEisenhowerDragEnd}>
            <div className="grid grid-cols-2 gap-3">
              <DroppableZone id="do" label="DO" dotColor="bg-quadrant-do" tasks={eGrouped.do} onTaskClick={setSelectedTask} isTaskRunning={isTaskRunning} onRunTask={runTask} pendingDecisionTaskIds={pendingDecisionTaskIds} />
              <DroppableZone id="schedule" label="SCHEDULE" dotColor="bg-quadrant-schedule" tasks={eGrouped.schedule} onTaskClick={setSelectedTask} isTaskRunning={isTaskRunning} onRunTask={runTask} pendingDecisionTaskIds={pendingDecisionTaskIds} />
              <DroppableZone id="delegate" label="DELEGATE" dotColor="bg-quadrant-delegate" tasks={eGrouped.delegate} onTaskClick={setSelectedTask} isTaskRunning={isTaskRunning} onRunTask={runTask} pendingDecisionTaskIds={pendingDecisionTaskIds} />
              <DroppableZone id="eliminate" label="ELIMINATE" dotColor="bg-quadrant-eliminate" tasks={eGrouped.eliminate} onTaskClick={setSelectedTask} isTaskRunning={isTaskRunning} onRunTask={runTask} pendingDecisionTaskIds={pendingDecisionTaskIds} />
            </div>
            <DragOverlay>{activeTask ? <TaskCard task={activeTask} className="shadow-xl" /> : null}</DragOverlay>
          </DndContext>
        </TabsContent>

        <TabsContent value="status-board">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleKanbanDragEnd}>
            <div className="grid grid-cols-3 gap-3">
              <DroppableZone id="not-started" label="Not Started" dotColor="bg-status-not-started" tasks={kGrouped["not-started"]} onTaskClick={setSelectedTask} isTaskRunning={isTaskRunning} onRunTask={runTask} pendingDecisionTaskIds={pendingDecisionTaskIds} />
              <DroppableZone id="in-progress" label="In Progress" dotColor="bg-status-in-progress" tasks={kGrouped["in-progress"]} onTaskClick={setSelectedTask} isTaskRunning={isTaskRunning} onRunTask={runTask} pendingDecisionTaskIds={pendingDecisionTaskIds} />
              <DroppableZone id="done" label="Done" dotColor="bg-status-done" tasks={kGrouped.done} onTaskClick={setSelectedTask} isTaskRunning={isTaskRunning} onRunTask={runTask} pendingDecisionTaskIds={pendingDecisionTaskIds} />
            </div>
            <DragOverlay>{activeTask ? <TaskCard task={activeTask} className="shadow-xl" /> : null}</DragOverlay>
          </DndContext>
        </TabsContent>

        <TabsContent value="milestones">
          {longTermGoals.length === 0 && milestones.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                No goals linked to this project yet.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {longTermGoals.map((g) => (
                <GoalCard key={g.id} goal={g} tasks={tasks} projects={projects} milestones={milestones} />
              ))}
              {milestones.filter((m) => !m.parentGoalId).map((m) => (
                <GoalCard key={m.id} goal={m} tasks={tasks} projects={projects} milestones={[]} />
              ))}
            </div>
          )}
        </TabsContent>

        {project.analysis && (
          <TabsContent value="scan">
            <div className="grid gap-3 lg:grid-cols-[1.2fr_0.8fr]">
              <Card>
                <CardContent className="space-y-4 p-4">
                  <div className="flex items-start gap-3">
                    <FileSearch className="mt-0.5 h-4 w-4 text-primary" />
                    <div className="space-y-1">
                      <h2 className="text-sm font-semibold">Directory Analysis</h2>
                      <p className="text-sm text-muted-foreground">{project.analysis.summary}</p>
                      <p className="text-xs text-muted-foreground">{project.analysis.sourceDirectory}</p>
                    </div>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-4">
                    {[
                      ["Stage", project.analysis.developmentStage.replace(/-/g, " ")],
                      ["Category", project.analysis.category],
                      ["Confidence", project.analysis.confidence],
                      ["Scanned", new Date(project.analysis.scannedAt).toLocaleString()],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-lg border bg-muted/20 p-3">
                        <div className="text-xs text-muted-foreground">{label}</div>
                        <div className="mt-1 text-sm font-medium capitalize">{value}</div>
                      </div>
                    ))}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
                    {[
                      ["Files", project.analysis.counts.filesScanned],
                      ["Source", project.analysis.counts.sourceFiles],
                      ["Tests", project.analysis.counts.testFiles],
                      ["Docs", project.analysis.counts.docsFiles],
                      ["Config", project.analysis.counts.configFiles],
                      ["TODOs", project.analysis.counts.todoMarkers],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-lg border p-3 text-center">
                        <div className="text-base font-semibold tabular-nums">{value}</div>
                        <div className="text-xs text-muted-foreground">{label}</div>
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {project.analysis.stack.map((item) => (
                      <Badge key={item} variant="secondary">{item}</Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="space-y-4 p-4">
                  <div className="flex items-center gap-2">
                    <Terminal className="h-4 w-4 text-primary" />
                    <h2 className="text-sm font-semibold">Commands</h2>
                  </div>
                  <div className="space-y-2">
                    {Object.entries(project.analysis.commands).map(([label, command]) => (
                      command ? (
                        <div key={label} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
                          <span className="text-xs font-medium capitalize text-muted-foreground">{label}</span>
                          <code className="text-xs">{command}</code>
                        </div>
                      ) : null
                    ))}
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-xs font-semibold text-muted-foreground">Notable files</h3>
                    <div className="max-h-40 space-y-1 overflow-auto rounded-md border p-2">
                      {project.analysis.notableFiles.map((file) => (
                        <div key={file} className="truncate text-xs text-muted-foreground">{file}</div>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="space-y-3 p-4">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                    <h2 className="text-sm font-semibold">Signals</h2>
                  </div>
                  <ul className="space-y-2">
                    {project.analysis.signals.map((signal) => (
                      <li key={signal} className="text-sm text-muted-foreground">{signal}</li>
                    ))}
                  </ul>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="space-y-3 p-4">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                    <h2 className="text-sm font-semibold">Risks and Next Steps</h2>
                  </div>
                  <div className="space-y-3">
                    {project.analysis.risks.map((risk) => (
                      <p key={risk} className="text-sm text-muted-foreground">{risk}</p>
                    ))}
                  </div>
                  <div className="space-y-2 border-t pt-3">
                    {project.analysis.recommendations.map((recommendation) => (
                      <div key={recommendation} className="text-sm">{recommendation}</div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        )}
      </Tabs>

      {/* Task Detail Panel */}
      {selectedTask && (
        <TaskDetailPanel
          task={selectedTask}
          projects={projects}
          goals={goals}
          allTasks={tasks}
          onUpdate={handleUpdateTask}
          onDelete={async () => { await deleteTask(selectedTask.id); setSelectedTask(null); }}
          onClose={() => setSelectedTask(null)}
        />
      )}

      <CreateTaskDialog
        open={showCreateTask}
        onOpenChange={setShowCreateTask}
        projects={projects}
        goals={goals}
        onSubmit={handleCreateTask}
        defaultValues={{ projectId }}
      />
    </div>
  );
}
