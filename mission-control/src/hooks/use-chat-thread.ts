"use client";

import { useCallback, useEffect, useState } from "react";
import type { ChatMessage, ChatThread } from "@/lib/types";

type ThreadResponse = { thread: ChatThread | null };
type SendResponse = { user: ChatMessage; assistant: ChatMessage; thread: ChatThread };

async function readErrorDetail(res: Response): Promise<string> {
  try {
    const body = await res.json();
    if (body && typeof body === "object" && typeof body.error === "string") return body.error;
  } catch {/* fall through */}
  return `Request failed (${res.status})`;
}

export function useChatThread(projectId: string) {
  const [thread, setThread] = useState<ChatThread | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/ai/threads/${encodeURIComponent(projectId)}`, { cache: "no-store" });
      if (!res.ok) throw new Error(await readErrorDetail(res));
      const data = (await res.json()) as ThreadResponse;
      setThread(data.thread);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void refetch(); }, [refetch]);

  const send = useCallback(async (message: string) => {
    if (!message.trim()) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/ai/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, message }),
      });
      if (!res.ok) throw new Error(await readErrorDetail(res));
      const data = (await res.json()) as SendResponse;
      setThread(data.thread);
    } catch (err) {
      setError(String(err));
    } finally {
      setSending(false);
    }
  }, [projectId]);

  const clear = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/ai/threads/${encodeURIComponent(projectId)}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await readErrorDetail(res));
      setThread(null);
    } catch (err) {
      setError(String(err));
    }
  }, [projectId]);

  return { thread, loading, sending, error, send, clear, refetch };
}
