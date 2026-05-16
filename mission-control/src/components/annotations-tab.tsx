"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { AnnotationCard } from "@/components/annotation-card";
import { AnnotationReanchorPicker } from "@/components/annotation-reanchor-picker";
import { useProjectAnnotations } from "@/hooks/use-project-annotations";
import type { Annotation } from "@/lib/types";

type Props = { projectId: string };

function attentionRank(a: Annotation): number {
  if (a.status === "orphaned") return 0;
  if (a.status === "open" && a.driftedAt) return 1;
  if (a.status === "open") return 2;
  return 3;
}

export function AnnotationsTab({ projectId }: Props) {
  const { annotations, loading, error, resolve, reopen, ackDrift, reAnchor, remove } =
    useProjectAnnotations(projectId);
  const [pickerOpenFor, setPickerOpenFor] = useState<string | null>(null);

  const sorted = [...annotations].sort((a, b) => {
    const r = attentionRank(a) - attentionRank(b);
    if (r !== 0) return r;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  return (
    <div className="flex h-full flex-col">
      <ScrollArea className="flex-1 px-3 py-3">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : sorted.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            No annotations yet. Add one by hovering a paragraph in the Spec tab and clicking the +.
          </p>
        ) : (
          <div className="space-y-2">
            {sorted.map((a) => (
              <div key={a.id} className="space-y-1.5">
                {a.status === "orphaned" && (
                  <div className="text-[10px] uppercase text-amber-700 dark:text-amber-400">
                    was in &ldquo;{a.sectionHeading}&rdquo; paragraph {a.paragraphIndex + 1}
                  </div>
                )}
                <AnnotationCard
                  annotation={a}
                  onResolve={() => resolve(a.id)}
                  onReopen={() => reopen(a.id)}
                  onDelete={() => remove(a.id)}
                  onAckDrift={() => ackDrift(a.id)}
                />
                {a.status === "orphaned" && (
                  pickerOpenFor === a.id ? (
                    <AnnotationReanchorPicker
                      projectId={projectId}
                      onCancel={() => setPickerOpenFor(null)}
                      onPick={async (section, paragraph) => {
                        await reAnchor(a.id, section, paragraph);
                        setPickerOpenFor(null);
                      }}
                    />
                  ) : (
                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setPickerOpenFor(a.id)}
                        className="h-6 px-2 text-xs"
                      >
                        Re-anchor
                      </Button>
                    </div>
                  )
                )}
              </div>
            ))}
          </div>
        )}
        {error && (
          <p className="mt-2 rounded border border-destructive/40 bg-destructive/5 px-2 py-1 text-xs text-destructive">
            {error}
          </p>
        )}
      </ScrollArea>
    </div>
  );
}
