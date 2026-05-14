"use client";

import { useState } from "react";
import { Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  initialBody?: string;
  submitting?: boolean;
  onSubmit: (body: string) => void;
  onCancel: () => void;
};

export function AnnotationComposer({ initialBody = "", submitting, onSubmit, onCancel }: Props) {
  const [body, setBody] = useState(initialBody);
  const trimmed = body.trim();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (trimmed) onSubmit(trimmed);
      }}
      className="mt-2 space-y-2 rounded-md border bg-muted/30 p-2"
    >
      <textarea
        autoFocus
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Add a note for this paragraph…"
        rows={3}
        className="w-full resize-y rounded-sm border bg-background px-2 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
      <div className="flex items-center justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={submitting} className="gap-1">
          <X className="h-3 w-3" /> Cancel
        </Button>
        <Button type="submit" size="sm" disabled={!trimmed || submitting} className="gap-1">
          {submitting && <Loader2 className="h-3 w-3 animate-spin" />}
          Save annotation
        </Button>
      </div>
    </form>
  );
}
