"use client";

import { Sparkles } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChatTab } from "@/components/chat-tab";

type Props = { projectId: string };

export function AISidePanel({ projectId }: Props) {
  return (
    <aside className="flex h-[calc(100vh-7rem)] flex-col rounded-xl border bg-card">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Sparkles className="h-3.5 w-3.5 text-primary" />
        <h2 className="text-xs font-semibold">Project Assistant</h2>
      </div>
      <Tabs defaultValue="chat" className="flex flex-1 flex-col">
        <TabsList className="m-2 mb-0">
          <TabsTrigger value="chat" className="text-xs">Chat</TabsTrigger>
          <TabsTrigger value="annotations" className="text-xs">Annotations</TabsTrigger>
        </TabsList>
        <TabsContent value="chat" className="mt-0 flex-1 overflow-hidden">
          <ChatTab projectId={projectId} />
        </TabsContent>
        <TabsContent value="annotations" className="mt-0 flex-1 overflow-hidden p-3">
          <p className="text-xs text-muted-foreground">
            The annotation queue lands in Plan 4. For now, manage annotations inline on the Spec tab.
          </p>
        </TabsContent>
      </Tabs>
    </aside>
  );
}
