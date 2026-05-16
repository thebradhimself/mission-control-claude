"use client";

import { useCallback, useEffect, useState } from "react";
import type { Annotation } from "@/lib/types";

type ListResponse = { annotations: Annotation[] };

async function readErrorDetail(res: Response): Promise<string> {
  try {
    const body = await res.json();
    if (body && typeof body === "object" && typeof body.error === "string") return body.error;
  } catch { /* fall through */ }
  return `Request failed (${res.status})`;
}

export function useProjectAnnotations(projectId: string) {
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/annotations?projectId=${encodeURIComponent(projectId)}`, { cache: "no-store" });
      if (!res.ok) throw new Error(await readErrorDetail(res));
      const data = (await res.json()) as ListResponse;
      setAnnotations(data.annotations);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void refetch(); }, [refetch]);

  const patch = useCallback(async (id: string, body: Record<string, unknown>) => {
    setError(null);
    try {
      const res = await fetch(`/api/annotations/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await readErrorDetail(res));
      const updated = (await res.json()) as Annotation;
      setAnnotations((prev) => prev.map((a) => (a.id === id ? updated : a)));
    } catch (err) {
      setError(String(err));
    }
  }, []);

  const resolve = useCallback((id: string) => patch(id, { status: "resolved" }), [patch]);
  const reopen = useCallback((id: string) => patch(id, { status: "open" }), [patch]);
  const ackDrift = useCallback((id: string) => patch(id, { ackDrift: true }), [patch]);
  const reAnchor = useCallback(
    (id: string, sectionHeading: string, paragraphIndex: number) =>
      patch(id, { sectionHeading, paragraphIndex }),
    [patch]
  );

  const remove = useCallback(async (id: string) => {
    setError(null);
    try {
      const res = await fetch(`/api/annotations/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await readErrorDetail(res));
      setAnnotations((prev) => prev.filter((a) => a.id !== id));
    } catch (err) {
      setError(String(err));
    }
  }, []);

  return { annotations, loading, error, resolve, reopen, ackDrift, reAnchor, remove, refetch };
}
