"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, X, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { parseSpecSections, type ParsedSection } from "@/lib/specs/parse";

type SpecResponse = { markdown: string | null; meta: unknown };

type Props = {
  projectId: string;
  onPick: (sectionHeading: string, paragraphIndex: number) => Promise<void> | void;
  onCancel: () => void;
};

export function AnnotationReanchorPicker({ projectId, onPick, onCancel }: Props) {
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [section, setSection] = useState<string>("");
  const [paragraph, setParagraph] = useState<number>(0);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/specs/${encodeURIComponent(projectId)}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`Failed to load spec (${res.status})`);
        const data = (await res.json()) as SpecResponse;
        if (cancelled) return;
        setMarkdown(data.markdown);
      } catch (err) {
        if (!cancelled) setError(String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [projectId]);

  const sections: ParsedSection[] = useMemo(
    () => (markdown ? parseSpecSections(markdown) : []),
    [markdown]
  );

  const currentSection = sections.find((s) => s.heading === section);

  useEffect(() => {
    if (!section && sections.length > 0) {
      setSection(sections[0].heading);
      setParagraph(0);
    }
  }, [sections, section]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-md border bg-card p-2 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> Loading spec…
      </div>
    );
  }

  if (error || !markdown || sections.length === 0) {
    return (
      <div className="flex items-center justify-between rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
        <span>{error ?? "No spec available to re-anchor against."}</span>
        <Button size="sm" variant="ghost" onClick={onCancel} className="h-6 px-2">Close</Button>
      </div>
    );
  }

  async function submit() {
    if (!currentSection) return;
    setSubmitting(true);
    try {
      await onPick(section, paragraph);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-2 rounded-md border bg-card p-2 text-xs">
      <label className="block">
        <span className="text-muted-foreground">Section</span>
        <select
          value={section}
          onChange={(e) => { setSection(e.target.value); setParagraph(0); }}
          className="mt-1 w-full rounded border bg-background px-1.5 py-1 text-xs"
        >
          {sections.map((s) => (
            <option key={s.heading} value={s.heading}>{s.heading}</option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="text-muted-foreground">Paragraph</span>
        <select
          value={paragraph}
          onChange={(e) => setParagraph(Number(e.target.value))}
          className="mt-1 w-full rounded border bg-background px-1.5 py-1 text-xs"
          disabled={!currentSection || currentSection.paragraphs.length === 0}
        >
          {currentSection?.paragraphs.map((p) => (
            <option key={p.index} value={p.index}>
              {p.index + 1}. {p.text.slice(0, 60).replace(/\s+/g, " ")}{p.text.length > 60 ? "…" : ""}
            </option>
          ))}
        </select>
      </label>
      <div className="flex justify-end gap-1.5 pt-1">
        <Button size="sm" variant="ghost" onClick={onCancel} className="h-6 gap-1 px-2">
          <X className="h-3 w-3" /> Cancel
        </Button>
        <Button size="sm" onClick={() => void submit()} disabled={submitting || !currentSection || currentSection.paragraphs.length === 0} className="h-6 gap-1 px-2">
          {submitting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
          Re-anchor
        </Button>
      </div>
    </div>
  );
}
