"use client";

import { useState, type KeyboardEvent } from "react";
import { Send, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type Props = {
  onSend: (message: string) => void | Promise<void>;
  disabled?: boolean;
  sending?: boolean;
};

export function ChatComposer({ onSend, disabled, sending }: Props) {
  const [value, setValue] = useState("");

  async function submit() {
    const text = value.trim();
    if (!text || disabled || sending) return;
    setValue("");
    await onSend(text);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  }

  return (
    <div className="flex items-end gap-2 border-t p-2">
      <Textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Ask about this project…"
        rows={2}
        className="resize-none text-sm"
        disabled={disabled || sending}
      />
      <Button
        size="sm"
        onClick={() => void submit()}
        disabled={disabled || sending || !value.trim()}
        aria-label="Send message"
      >
        {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
      </Button>
    </div>
  );
}
