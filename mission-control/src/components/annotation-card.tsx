"use client";

import { Check, Trash2, AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { Annotation } from "@/lib/types";

type Props = {
  annotation: Annotation;
  onResolve: () => void;
  onReopen: () => void;
  onDelete: () => void;
  onAckDrift?: () => void;
};

function statusLabel(a: Annotation): "drifted" | Annotation["status"] {
  if (a.status === "open" && a.driftedAt) return "drifted";
  return a.status;
}

export function AnnotationCard({ annotation, onResolve, onReopen, onDelete, onAckDrift }: Props) {
  const label = statusLabel(annotation);
  const isOrphan = annotation.status === "orphaned";
  const isDrifted = label === "drifted";
  const isResolved = annotation.status === "resolved";

  const badgeVariant =
    isResolved ? "secondary"
    : isOrphan ? "outline"
    : isDrifted ? "outline"
    : "default";

  return (
    <div className="rounded-md border bg-card p-2 text-sm space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Badge variant={badgeVariant} className="text-[10px] uppercase">
          {label}
        </Badge>
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {new Date(annotation.createdAt).toLocaleString()}
        </span>
      </div>
      {isOrphan && (
        <div className="flex items-center gap-1 text-xs text-amber-600">
          <AlertTriangle className="h-3 w-3" /> Original paragraph no longer in spec.
        </div>
      )}
      {isDrifted && (
        <div className="flex items-center gap-1 text-xs text-amber-600">
          <AlertTriangle className="h-3 w-3" /> Paragraph changed since you wrote this note.
        </div>
      )}
      <p className="whitespace-pre-wrap text-sm">{annotation.body}</p>
      <div className="flex items-center justify-end gap-1.5 pt-1">
        {isDrifted && onAckDrift && (
          <Button size="sm" variant="ghost" onClick={onAckDrift} className="h-6 gap-1 px-2 text-xs">
            <RotateCcw className="h-3 w-3" /> Acknowledge
          </Button>
        )}
        {isResolved ? (
          <Button size="sm" variant="ghost" onClick={onReopen} className="h-6 px-2 text-xs">
            Reopen
          </Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={onResolve} className="h-6 gap-1 px-2 text-xs">
            <Check className="h-3 w-3" /> Resolve
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onDelete} className="h-6 gap-1 px-2 text-xs text-destructive hover:text-destructive">
          <Trash2 className="h-3 w-3" /> Delete
        </Button>
      </div>
    </div>
  );
}
