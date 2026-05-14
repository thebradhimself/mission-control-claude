"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FolderInput, Loader2, X, Users } from "lucide-react";
import { useAgents } from "@/hooks/use-data";
import { getAgentIcon } from "@/lib/agent-icons";
import { ProjectTypeSelector } from "@/components/project-type-selector";
import type { ProjectType } from "@/lib/types";

const PROJECT_COLORS = [
  "#6366f1", "#8b5cf6", "#ec4899", "#f43f5e",
  "#f97316", "#eab308", "#22c55e", "#06b6d4",
];

interface CreateProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: { name: string; description: string; color: string; tags: string; teamMembers: string[]; type: ProjectType | null }) => void;
  onImportDirectory?: (data: { directory: string; color: string; createTasks: boolean }) => Promise<void>;
}

export function CreateProjectDialog({ open, onOpenChange, onSubmit, onImportDirectory }: CreateProjectDialogProps) {
  const { agents } = useAgents();
  const activeAgents = agents.filter((a) => a.status === "active");

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState(PROJECT_COLORS[0]);
  const [tags, setTags] = useState("");
  const [teamMembers, setTeamMembers] = useState<string[]>([]);
  const [directory, setDirectory] = useState("");
  const [importing, setImporting] = useState(false);
  const [type, setType] = useState<ProjectType | null>(null);

  const toggleTeamMember = (agentId: string) => {
    setTeamMembers((prev) =>
      prev.includes(agentId) ? prev.filter((id) => id !== agentId) : [...prev, agentId]
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSubmit({ name: name.trim(), description, color, tags, teamMembers, type });
    setName("");
    setDescription("");
    setColor(PROJECT_COLORS[0]);
    setTags("");
    setTeamMembers([]);
    setType(null);
    onOpenChange(false);
  };

  const handleImportDirectory = async () => {
    if (!directory.trim() || !onImportDirectory || importing) return;
    setImporting(true);
    try {
      await onImportDirectory({ directory: directory.trim(), color, createTasks: true });
      setDirectory("");
      onOpenChange(false);
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Venture</DialogTitle>
          <DialogDescription>A venture is a business, product, or initiative you&apos;re building. Group related tasks, assign agents, and track progress.</DialogDescription>
        </DialogHeader>
        {onImportDirectory && (
          <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
            <div className="flex items-center gap-2">
              <FolderInput className="h-4 w-4 text-primary" />
              <Label htmlFor="proj-directory" className="text-sm font-medium">Import from directory</Label>
            </div>
            <div className="flex gap-2">
              <Input
                id="proj-directory"
                value={directory}
                onChange={(e) => setDirectory(e.target.value)}
                placeholder="/Users/bradleyhintze/workspace/projects/my-app"
                disabled={importing}
              />
              <Button
                type="button"
                variant="secondary"
                onClick={handleImportDirectory}
                disabled={!directory.trim() || importing}
                className="gap-1.5"
              >
                {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FolderInput className="h-3.5 w-3.5" />}
                Scan
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Scans structure, docs, package scripts, tests, Git state, and code markers, then creates a venture with follow-up tasks.
            </p>
          </div>
        )}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="proj-name">Name</Label>
            <Input
              id="proj-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Venture name"
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="proj-desc">Description</Label>
            <Textarea
              id="proj-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this venture about?"
              rows={3}
            />
          </div>
          <div className="space-y-2">
            <Label>Color</Label>
            <div className="flex gap-2">
              {PROJECT_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`h-7 w-7 rounded-full border-2 transition-transform ${
                    color === c ? "scale-110 border-foreground" : "border-transparent hover:scale-105"
                  }`}
                  style={{ backgroundColor: c }}
                  onClick={() => setColor(c)}
                />
              ))}
            </div>
          </div>
          {/* Team Members */}
          {activeAgents.length > 0 && (
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5" />
                Team Members
                {teamMembers.length > 0 && (
                  <span className="text-xs text-muted-foreground ml-1">
                    {teamMembers.length} selected
                  </span>
                )}
              </Label>
              {/* Selected members */}
              {teamMembers.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {teamMembers.map((memberId) => {
                    const agent = activeAgents.find((a) => a.id === memberId);
                    const MemberIcon = getAgentIcon(memberId, agent?.icon);
                    return (
                      <Badge key={memberId} variant="secondary" className="gap-1 pr-1 text-xs">
                        <MemberIcon className="h-3 w-3" />
                        {agent?.name ?? memberId}
                        <button
                          type="button"
                          onClick={() => toggleTeamMember(memberId)}
                          className="rounded-full hover:bg-muted-foreground/20 p-0.5 ml-0.5"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    );
                  })}
                </div>
              )}
              {/* Available agents */}
              <div className="flex flex-wrap gap-1.5">
                {activeAgents
                  .filter((a) => !teamMembers.includes(a.id))
                  .map((agent) => {
                    const AgentIcon = getAgentIcon(agent.id, agent.icon);
                    return (
                      <button
                        key={agent.id}
                        type="button"
                        onClick={() => toggleTeamMember(agent.id)}
                        className="flex items-center gap-1 rounded-md border border-dashed px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                      >
                        <AgentIcon className="h-3 w-3" />
                        {agent.name}
                      </button>
                    );
                  })}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="proj-tags">Tags (comma-separated)</Label>
            <Input
              id="proj-tags"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="saas, web, mobile..."
            />
          </div>
          <ProjectTypeSelector value={type} onChange={setType} id="create-project-type" />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim()}>
              Create Venture
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
