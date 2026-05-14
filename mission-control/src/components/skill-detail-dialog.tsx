"use client";

import Link from "next/link";
import { Pencil, Tag } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import type { SkillDefinition } from "@/lib/types";

interface SkillDetailDialogProps {
  skill: SkillDefinition | null;
  agentNames: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SkillDetailDialog({
  skill,
  agentNames,
  open,
  onOpenChange,
}: SkillDetailDialogProps) {
  if (!skill) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col gap-0 p-0">
        <DialogHeader className="border-b px-6 py-4 space-y-2">
          <DialogTitle className="pr-8">{skill.name}</DialogTitle>
          {skill.description && (
            <DialogDescription className="text-left">
              {skill.description}
            </DialogDescription>
          )}
          {(agentNames.length > 0 || skill.tags.length > 0) && (
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              {agentNames.map((name) => (
                <Badge key={`agent-${name}`} variant="outline" className="text-[10px] px-1.5 py-0">
                  {name}
                </Badge>
              ))}
              {skill.tags.length > 0 && (
                <>
                  {agentNames.length > 0 && <span className="text-muted-foreground/50">·</span>}
                  <Tag className="h-3 w-3 text-muted-foreground" />
                  {skill.tags.map((tag) => (
                    <Badge key={`tag-${tag}`} variant="secondary" className="text-[10px] px-1.5 py-0">
                      {tag}
                    </Badge>
                  ))}
                </>
              )}
            </div>
          )}
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <MarkdownRenderer content={skill.content} />
        </div>

        <DialogFooter className="border-t px-6 py-3 sm:justify-between">
          <span className="text-xs text-muted-foreground hidden sm:inline">
            {skill.content.length.toLocaleString()} characters
          </span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button asChild size="sm" className="gap-1.5">
              <Link href={`/skills/${skill.id}`}>
                <Pencil className="h-3.5 w-3.5" /> Edit
              </Link>
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
