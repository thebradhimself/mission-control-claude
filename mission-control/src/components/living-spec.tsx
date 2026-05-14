"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AnnotatableParagraph } from "@/components/annotatable-paragraph";
import { parseSpecSections, type ParsedSection } from "@/lib/specs/parse";
import type { SpecMeta } from "@/lib/specs/storage";
import type { Annotation } from "@/lib/types";

type SpecResponse = { markdown: string | null; meta: SpecMeta | null };
type RegenResponse = { markdown: string; meta: SpecMeta };
type AnnotationsResponse = { annotations: Annotation[] };

type Props = {
  projectId: string;
};

const STALE_MS = 12 * 60 * 60 * 1000;

async function readErrorDetail(res: Response): Promise<string> {
  try {
    const body = await res.json();
    if (body && typeof body === "object" && typeof body.error === "string") {
      return body.error;
    }
  } catch {
    /* fall through */
  }
  return `Request failed (${res.status})`;
}

export function LivingSpec({ projectId }: Props) {
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [meta, setMeta] = useState<SpecMeta | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [submittingAnn, setSubmittingAnn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAnnotations = useCallback(async () => {
    const res = await fetch(`/api/annotations?projectId=${encodeURIComponent(projectId)}`, { cache: "no-store" });
    if (!res.ok) throw new Error(await readErrorDetail(res));
    const data = (await res.json()) as AnnotationsResponse;
    setAnnotations(data.annotations);
  }, [projectId]);

  const fetchSpec = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/specs/${encodeURIComponent(projectId)}`, { cache: "no-store" });
      if (!res.ok) throw new Error(await readErrorDetail(res));
      const data = (await res.json()) as SpecResponse;
      setMarkdown(data.markdown);
      setMeta(data.meta);
      if (data.markdown) await fetchAnnotations();
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [projectId, fetchAnnotations]);

  const regen = useCallback(
    async (reason: "manual" | "stale-view") => {
      setRegenerating(true);
      setError(null);
      try {
        const res = await fetch(`/api/ai/spec-regen`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId, reason }),
        });
        if (!res.ok) throw new Error(await readErrorDetail(res));
        const data = (await res.json()) as RegenResponse;
        setMarkdown(data.markdown);
        setMeta(data.meta);
        await fetchAnnotations();
      } catch (err) {
        setError(String(err));
      } finally {
        setRegenerating(false);
      }
    },
    [projectId, fetchAnnotations]
  );

  useEffect(() => {
    fetchSpec();
  }, [fetchSpec]);

  useEffect(() => {
    if (loading || regenerating || error) return;
    const isMissing = markdown === null;
    const isStale = meta && Date.now() - new Date(meta.generatedAt).getTime() > STALE_MS;
    if (isMissing || isStale) {
      regen("stale-view");
    }
  }, [loading, regenerating, error, markdown, meta, regen]);

  const sections: ParsedSection[] = useMemo(
    () => (markdown ? parseSpecSections(markdown) : []),
    [markdown]
  );

  const annotationsByAnchor = useMemo(() => {
    const map = new Map<string, Annotation[]>();
    for (const a of annotations) {
      if (a.status === "resolved") continue;
      if (a.status === "orphaned") continue;
      const key = `${a.sectionHeading} ${a.paragraphIndex}`;
      const list = map.get(key) ?? [];
      list.push(a);
      map.set(key, list);
    }
    return map;
  }, [annotations]);

  const orphans = useMemo(() => annotations.filter((a) => a.status === "orphaned"), [annotations]);

  const createAnnotation = useCallback(
    async (sectionHeading: string, paragraphIndex: number, body: string) => {
      setSubmittingAnn(true);
      setError(null);
      try {
        const res = await fetch(`/api/annotations`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId, sectionHeading, paragraphIndex, body }),
        });
        if (!res.ok) throw new Error(await readErrorDetail(res));
        const created = (await res.json()) as Annotation;
        setAnnotations((prev) => [...prev, created]);
      } catch (err) {
        setError(String(err));
      } finally {
        setSubmittingAnn(false);
      }
    },
    [projectId]
  );

  const patchAnnotation = useCallback(async (id: string, patch: { status?: Annotation["status"]; body?: string }) => {
    setError(null);
    try {
      const res = await fetch(`/api/annotations/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(await readErrorDetail(res));
      const updated = (await res.json()) as Annotation;
      setAnnotations((prev) => prev.map((a) => (a.id === id ? updated : a)));
    } catch (err) {
      setError(String(err));
    }
  }, []);

  const deleteAnnotation = useCallback(async (id: string) => {
    setError(null);
    try {
      const res = await fetch(`/api/annotations/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await readErrorDetail(res));
      setAnnotations((prev) => prev.filter((a) => a.id !== id));
    } catch (err) {
      setError(String(err));
    }
  }, []);

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading spec…
      </div>
    );
  }

  if (regenerating && !markdown) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Generating spec from project data…
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {meta ? `Last regen: ${new Date(meta.generatedAt).toLocaleString()} (${meta.reason})` : "No spec yet"}
        </span>
        <Button size="sm" variant="ghost" onClick={() => regen("manual")} disabled={regenerating} className="gap-1.5">
          {regenerating ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          Regenerate
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
          {error}
        </div>
      )}

      {orphans.length > 0 && (
        <div className="rounded-md border border-amber-500/40 bg-amber-50/50 p-2 text-xs dark:bg-amber-950/20">
          <div className="font-medium text-amber-700 dark:text-amber-400">
            {orphans.length} orphaned annotation{orphans.length === 1 ? "" : "s"}
          </div>
          <p className="mt-0.5 text-muted-foreground">
            The paragraph these notes pointed to is no longer in the spec. Review and delete or recreate them.
          </p>
        </div>
      )}

      {sections.map((section) => (
        <section key={section.heading} className="space-y-2">
          <h2 className="text-base font-semibold">{section.heading}</h2>
          {section.paragraphs.length === 0 ? (
            <p className="text-xs italic text-muted-foreground">(empty section)</p>
          ) : (
            section.paragraphs.map((p) => {
              const key = `${section.heading} ${p.index}`;
              const anns = annotationsByAnchor.get(key) ?? [];
              return (
                <AnnotatableParagraph
                  key={`${section.heading}-${p.index}`}
                  sectionHeading={section.heading}
                  paragraphIndex={p.index}
                  text={p.text}
                  annotations={anns}
                  submitting={submittingAnn}
                  onCreate={(body) => createAnnotation(section.heading, p.index, body)}
                  onResolve={(id) => patchAnnotation(id, { status: "resolved" })}
                  onReopen={(id) => patchAnnotation(id, { status: "open" })}
                  onDelete={deleteAnnotation}
                />
              );
            })
          )}
        </section>
      ))}

      {orphans.length > 0 && (
        <section className="space-y-2 border-t pt-3">
          <h3 className="text-xs font-semibold uppercase text-muted-foreground">Orphaned annotations</h3>
          {orphans.map((a) => (
            <div key={a.id} className="rounded-md border border-amber-500/40 bg-card p-2 text-sm">
              <div className="text-[10px] uppercase text-amber-700 dark:text-amber-400">
                was in &ldquo;{a.sectionHeading}&rdquo; paragraph {a.paragraphIndex + 1}
              </div>
              <p className="whitespace-pre-wrap pt-1">{a.body}</p>
              <div className="flex justify-end gap-1.5 pt-1">
                <Button size="sm" variant="ghost" onClick={() => deleteAnnotation(a.id)} className="h-6 px-2 text-xs text-destructive hover:text-destructive">
                  Delete
                </Button>
              </div>
            </div>
          ))}
        </section>
      )}

      {/* Fallback: if parser produced no sections, render raw markdown so the user still sees content */}
      {sections.length === 0 && markdown && (
        <article className="prose prose-sm dark:prose-invert max-w-none">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
        </article>
      )}
    </div>
  );
}
