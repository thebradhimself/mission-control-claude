"use client";

import { useEffect, useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SpecMeta } from "@/lib/specs/storage";

type SpecResponse = { markdown: string | null; meta: SpecMeta | null };
type RegenResponse = { markdown: string; meta: SpecMeta };

async function readErrorDetail(res: Response): Promise<string> {
  try {
    const body = await res.json();
    if (body && typeof body === "object" && typeof body.error === "string") {
      return body.error;
    }
  } catch {
    // fall through
  }
  return `Request failed (${res.status})`;
}

type Props = {
  projectId: string;
};

const STALE_MS = 12 * 60 * 60 * 1000;

export function LivingSpec({ projectId }: Props) {
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [meta, setMeta] = useState<SpecMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSpec = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/specs/${encodeURIComponent(projectId)}`, { cache: "no-store" });
      if (!res.ok) {
        const detail = await readErrorDetail(res);
        throw new Error(detail);
      }
      const data = (await res.json()) as SpecResponse;
      setMarkdown(data.markdown);
      setMeta(data.meta);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  const regen = useCallback(async (reason: "manual" | "stale-view") => {
    setRegenerating(true);
    setError(null);
    try {
      const res = await fetch(`/api/ai/spec-regen`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, reason }),
      });
      if (!res.ok) {
        const detail = await readErrorDetail(res);
        throw new Error(detail);
      }
      const data = (await res.json()) as RegenResponse;
      setMarkdown(data.markdown);
      setMeta(data.meta);
    } catch (err) {
      setError(String(err));
    } finally {
      setRegenerating(false);
    }
  }, [projectId]);

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
        <Button
          size="sm"
          variant="ghost"
          onClick={() => regen("manual")}
          disabled={regenerating}
          className="gap-1.5"
        >
          {regenerating ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          Regenerate
        </Button>
      </div>
      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
          {error}
        </div>
      )}
      {markdown && (
        <article className="prose prose-sm dark:prose-invert max-w-none">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
        </article>
      )}
    </div>
  );
}
