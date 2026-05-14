"use client";

import { MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  count: number;
  hasOrphan?: boolean;
  onClick: () => void;
};

export function AnnotationMarker({ count, hasOrphan, onClick }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${count} annotation${count === 1 ? "" : "s"}`}
      className={cn(
        "inline-flex items-center gap-0.5 rounded-md border px-1.5 py-0.5 text-xs",
        "transition-colors hover:bg-accent",
        hasOrphan ? "border-amber-500/60 text-amber-600" : "border-primary/40 text-primary"
      )}
    >
      <MessageSquare className="h-3 w-3" />
      <span className="tabular-nums">{count}</span>
    </button>
  );
}
