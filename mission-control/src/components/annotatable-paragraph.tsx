"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Plus } from "lucide-react";
import { AnnotationMarker } from "@/components/annotation-marker";
import { AnnotationComposer } from "@/components/annotation-composer";
import { AnnotationCard } from "@/components/annotation-card";
import type { Annotation } from "@/lib/types";

type Props = {
  sectionHeading: string;
  paragraphIndex: number;
  text: string;
  annotations: Annotation[];
  submitting?: boolean;
  onCreate: (body: string) => Promise<void> | void;
  onResolve: (id: string) => Promise<void> | void;
  onReopen: (id: string) => Promise<void> | void;
  onDelete: (id: string) => Promise<void> | void;
};

export function AnnotatableParagraph({
  paragraphIndex,
  text,
  annotations,
  submitting,
  onCreate,
  onResolve,
  onReopen,
  onDelete,
}: Props) {
  const [composerOpen, setComposerOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);

  const count = annotations.length;
  const hasOrphan = annotations.some((a) => a.status === "orphaned");

  const handleCreate = async (body: string) => {
    await onCreate(body);
    setComposerOpen(false);
  };

  return (
    <div className="group relative -mx-2 rounded-md px-2 py-1 transition-colors hover:bg-muted/30">
      <div className="flex items-start gap-2">
        <div className="prose prose-sm dark:prose-invert max-w-none flex-1 [&>p]:my-0">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
        </div>
        <div className="flex shrink-0 items-center gap-1 pt-0.5">
          {count > 0 && (
            <AnnotationMarker
              count={count}
              hasOrphan={hasOrphan}
              onClick={() => setListOpen((v) => !v)}
            />
          )}
          <button
            type="button"
            onClick={() => setComposerOpen((v) => !v)}
            aria-label={`Add annotation to paragraph ${paragraphIndex + 1}`}
            className="rounded-md border border-dashed border-transparent p-0.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:border-border hover:text-foreground"
          >
            <Plus className="h-3 w-3" />
          </button>
        </div>
      </div>
      {composerOpen && (
        <AnnotationComposer
          submitting={submitting}
          onSubmit={handleCreate}
          onCancel={() => setComposerOpen(false)}
        />
      )}
      {listOpen && count > 0 && (
        <div className="mt-2 space-y-1.5">
          {annotations.map((a) => (
            <AnnotationCard
              key={a.id}
              annotation={a}
              onResolve={() => onResolve(a.id)}
              onReopen={() => onReopen(a.id)}
              onDelete={() => onDelete(a.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
