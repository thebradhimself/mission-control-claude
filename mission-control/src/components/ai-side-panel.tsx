"use client";

import { Sparkles } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ChatTab } from "@/components/chat-tab";
import { AnnotationsTab } from "@/components/annotations-tab";
import { useProjectAnnotations } from "@/hooks/use-project-annotations";

type Props = { projectId: string };

export function AISidePanel({ projectId }: Props) {
  const { annotations } = useProjectAnnotations(projectId);
  const needsAttention = annotations.filter((a) => a.status !== "resolved").length;

  return (
    <aside className="flex h-[calc(100vh-7rem)] flex-col rounded-xl border bg-card">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Sparkles className="h-3.5 w-3.5 text-primary" />
        <h2 className="text-xs font-semibold">Project Assistant</h2>
      </div>
      <Tabs defaultValue="chat" className="flex flex-1 flex-col">
        <TabsList className="m-2 mb-0">
          <TabsTrigger value="chat" className="text-xs">Chat</TabsTrigger>
          <TabsTrigger value="annotations" className="gap-1.5 text-xs">
            Annotations
            {needsAttention > 0 && (
              <Badge variant="secondary" className="h-4 min-w-[1rem] justify-center px-1 text-[10px] tabular-nums">
                {needsAttention}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="chat" className="mt-0 flex-1 overflow-hidden">
          <ChatTab projectId={projectId} />
        </TabsContent>
        <TabsContent value="annotations" className="mt-0 flex-1 overflow-hidden">
          <AnnotationsTab projectId={projectId} />
        </TabsContent>
      </Tabs>
    </aside>
  );
}
