"use client";

import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChatComposer } from "@/components/chat-composer";
import { ChatMessage } from "@/components/chat-message";
import { useChatThread } from "@/hooks/use-chat-thread";

type Props = { projectId: string };

export function ChatTab({ projectId }: Props) {
  const { thread, loading, sending, error, send, clear } = useChatThread(projectId);
  const messages = thread?.messages ?? [];

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="text-xs text-muted-foreground tabular-nums">
          {messages.length} message{messages.length === 1 ? "" : "s"}
        </span>
        {messages.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void clear()}
            className="h-7 gap-1 text-xs text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-3 w-3" /> Clear
          </Button>
        )}
      </div>

      <ScrollArea className="flex-1 px-3 py-3">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : messages.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            Ask anything about this project. The assistant sees the spec, tasks, recent activity, pending decisions, and unread inbox messages.
          </p>
        ) : (
          <div className="space-y-2">
            {messages.map((m) => <ChatMessage key={m.id} message={m} />)}
            {sending && (
              <div className="flex items-center gap-2 px-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Thinking…
              </div>
            )}
          </div>
        )}
        {error && (
          <p className="mt-2 rounded border border-destructive/40 bg-destructive/5 px-2 py-1 text-xs text-destructive">
            {error}
          </p>
        )}
      </ScrollArea>

      <ChatComposer onSend={send} sending={sending} disabled={loading} />
    </div>
  );
}
