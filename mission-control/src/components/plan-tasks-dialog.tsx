"use client";

import { useEffect, useState } from "react";
import { Loader2, Sparkles, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { apiFetch } from "@/lib/api-client";
import { showError, showSuccess } from "@/lib/toast";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  onTasksCreated?: () => void;
}

type Importance = "important" | "not-important";
type Urgency = "urgent" | "not-urgent";

interface ProposedTask {
  title: string;
  description: string;
  importance: Importance;
  urgency: Urgency;
  estimatedMinutes?: number;
  acceptanceCriteria?: string[];
  selected: boolean;
}

type Phase =
  | { kind: "idle" }
  | { kind: "analyzing" }
  | { kind: "clarifying"; questions: string[]; answers: string[] }
  | { kind: "generating" }
  | { kind: "previewing"; tasks: ProposedTask[] }
  | { kind: "creating" };

function decoratePhase(phase: Phase): { title: string; description: string } {
  switch (phase.kind) {
    case "idle":
    case "analyzing":
      return {
        title: "Plan tasks from chat",
        description: "Reading your conversation, spec, and existing tasks…",
      };
    case "clarifying":
      return {
        title: "A few questions first",
        description: "Answer what you can — leave blanks if you're not sure.",
      };
    case "generating":
      return {
        title: "Drafting your task list",
        description: "Using your answers to propose concrete tasks…",
      };
    case "previewing":
      return {
        title: "Review proposed tasks",
        description: "Edit, deselect, or remove before creating.",
      };
    case "creating":
      return {
        title: "Creating tasks",
        description: "Saving to your task list…",
      };
  }
}

export function PlanTasksDialog({ open, onOpenChange, projectId, onTasksCreated }: Props) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  // Reset when the dialog opens; kick off the first analysis call.
  useEffect(() => {
    if (!open) {
      setPhase({ kind: "idle" });
      return;
    }
    void runPlan();
    // We deliberately depend only on `open` — re-running on projectId change while open is intentional.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function runPlan(clarifications?: { question: string; answer: string }[]) {
    setPhase({ kind: clarifications ? "generating" : "analyzing" });
    try {
      const res = await apiFetch("/api/ai/plan-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, clarifications }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Plan failed" }));
        throw new Error(err.error ?? "Plan failed");
      }
      const data = (await res.json()) as
        | { mode: "questions"; questions: string[] }
        | {
            mode: "tasks";
            tasks: Array<{
              title: string;
              description: string;
              importance: Importance;
              urgency: Urgency;
              estimatedMinutes?: number;
              acceptanceCriteria?: string[];
            }>;
          };

      if (data.mode === "questions") {
        setPhase({
          kind: "clarifying",
          questions: data.questions,
          answers: data.questions.map(() => ""),
        });
      } else {
        setPhase({
          kind: "previewing",
          tasks: data.tasks.map((t) => ({ ...t, selected: true })),
        });
      }
    } catch (err) {
      showError(err instanceof Error ? err.message : "Could not plan tasks");
      onOpenChange(false);
    }
  }

  async function submitClarifications() {
    if (phase.kind !== "clarifying") return;
    const clarifications = phase.questions.map((q, i) => ({
      question: q,
      answer: phase.answers[i]?.trim() ?? "",
    }));
    await runPlan(clarifications);
  }

  async function createSelectedTasks() {
    if (phase.kind !== "previewing") return;
    const selected = phase.tasks.filter((t) => t.selected);
    if (selected.length === 0) {
      showError("Select at least one task or cancel.");
      return;
    }
    setPhase({ kind: "creating" });

    let createdCount = 0;
    for (const task of selected) {
      try {
        const res = await apiFetch("/api/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: task.title,
            description: task.description,
            importance: task.importance,
            urgency: task.urgency,
            projectId,
            estimatedMinutes: task.estimatedMinutes ?? null,
            acceptanceCriteria: task.acceptanceCriteria ?? [],
          }),
        });
        if (res.ok) createdCount += 1;
      } catch {
        // Continue with remaining tasks; we report the count at the end.
      }
    }

    if (createdCount === selected.length) {
      showSuccess(`Created ${createdCount} task${createdCount === 1 ? "" : "s"}`);
    } else if (createdCount > 0) {
      showError(`Created ${createdCount} of ${selected.length} tasks — some failed`);
    } else {
      showError("No tasks were created");
    }

    onTasksCreated?.();
    onOpenChange(false);
  }

  const decor = decoratePhase(phase);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            {decor.title}
          </DialogTitle>
          <DialogDescription>{decor.description}</DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto pr-1">
          {(phase.kind === "analyzing" || phase.kind === "generating" || phase.kind === "creating") && (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {decor.description}
            </div>
          )}

          {phase.kind === "clarifying" && (
            <div className="space-y-4 py-2">
              {phase.questions.map((q, i) => (
                <div key={i} className="space-y-2">
                  <Label htmlFor={`q-${i}`} className="text-sm font-medium">
                    {q}
                  </Label>
                  <Textarea
                    id={`q-${i}`}
                    rows={2}
                    value={phase.answers[i]}
                    onChange={(e) => {
                      const next = [...phase.answers];
                      next[i] = e.target.value;
                      setPhase({ ...phase, answers: next });
                    }}
                    placeholder="Your answer (optional)"
                  />
                </div>
              ))}
            </div>
          )}

          {phase.kind === "previewing" && (
            <div className="space-y-3 py-2">
              {phase.tasks.length === 0 && (
                <p className="py-12 text-center text-sm text-muted-foreground">
                  The assistant didn&apos;t propose any tasks. Try having a more concrete chat first.
                </p>
              )}
              {phase.tasks.map((task, i) => (
                <ProposedTaskRow
                  key={i}
                  task={task}
                  onChange={(updated) => {
                    const next = [...phase.tasks];
                    next[i] = updated;
                    setPhase({ ...phase, tasks: next });
                  }}
                  onRemove={() => {
                    const next = phase.tasks.filter((_, idx) => idx !== i);
                    setPhase({ ...phase, tasks: next });
                  }}
                />
              ))}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {phase.kind === "clarifying" && (
            <Button onClick={submitClarifications}>Continue</Button>
          )}
          {phase.kind === "previewing" && (
            <Button
              onClick={createSelectedTasks}
              disabled={phase.tasks.filter((t) => t.selected).length === 0}
            >
              Create {phase.tasks.filter((t) => t.selected).length} task
              {phase.tasks.filter((t) => t.selected).length === 1 ? "" : "s"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Proposed task row ──────────────────────────────────────────────────────

interface RowProps {
  task: ProposedTask;
  onChange: (next: ProposedTask) => void;
  onRemove: () => void;
}

function ProposedTaskRow({ task, onChange, onRemove }: RowProps) {
  return (
    <div className="rounded-md border p-3 space-y-2 bg-card/30">
      <div className="flex items-start gap-2">
        <Checkbox
          checked={task.selected}
          onCheckedChange={(v) => onChange({ ...task, selected: v === true })}
          className="mt-1"
          aria-label="Include this task"
        />
        <div className="flex-1 space-y-2">
          <Input
            value={task.title}
            onChange={(e) => onChange({ ...task, title: e.target.value })}
            placeholder="Task title"
            className="font-medium"
          />
          <Textarea
            value={task.description}
            onChange={(e) => onChange({ ...task, description: e.target.value })}
            rows={2}
            placeholder="What does this task accomplish?"
            className="text-sm"
          />
          <div className="flex flex-wrap gap-2 items-center text-xs">
            <Select
              value={task.importance}
              onValueChange={(v) =>
                onChange({ ...task, importance: v as Importance })
              }
            >
              <SelectTrigger className="h-7 w-[140px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="important">Important</SelectItem>
                <SelectItem value="not-important">Not important</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={task.urgency}
              onValueChange={(v) => onChange({ ...task, urgency: v as Urgency })}
            >
              <SelectTrigger className="h-7 w-[140px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="urgent">Urgent</SelectItem>
                <SelectItem value="not-urgent">Not urgent</SelectItem>
              </SelectContent>
            </Select>
            {task.estimatedMinutes !== undefined && (
              <span className="text-muted-foreground">
                ~{task.estimatedMinutes}m
              </span>
            )}
            {task.acceptanceCriteria && task.acceptanceCriteria.length > 0 && (
              <span className="text-muted-foreground">
                {task.acceptanceCriteria.length} criterion
                {task.acceptanceCriteria.length === 1 ? "" : "ia"}
              </span>
            )}
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
          onClick={onRemove}
          aria-label="Remove this task"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
