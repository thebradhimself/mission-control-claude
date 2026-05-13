"use client";

import { useId } from "react";
import { Code2, FileText, Briefcase, HelpCircle } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import type { ProjectType } from "@/lib/types";

type Props = {
  value: ProjectType | null;
  onChange: (value: ProjectType | null) => void;
  id?: string;
};

const TYPE_META: Record<ProjectType, { label: string; description: string; Icon: React.ComponentType<{ className?: string }> }> = {
  software: { label: "Software", description: "App, tool, library, or product code", Icon: Code2 },
  content: { label: "Content", description: "Writing, posts, video, design pipeline", Icon: FileText },
  business: { label: "Business / Strategy", description: "Goals, metrics, initiatives, decisions", Icon: Briefcase },
};

const NONE_VALUE = "__none__";

export function ProjectTypeSelector({ value, onChange, id }: Props) {
  const generatedId = useId();
  const resolvedId = id ?? generatedId;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={resolvedId}>Project type</Label>
      <Select
        value={value ?? NONE_VALUE}
        onValueChange={(v) => onChange(v === NONE_VALUE ? null : (v as ProjectType))}
      >
        <SelectTrigger id={resolvedId}>
          <SelectValue placeholder="Choose a type" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE_VALUE} textValue="Not set">
            <div className="flex items-center gap-2">
              <HelpCircle className="h-4 w-4 text-muted-foreground" />
              <span>Not set (defaults to software)</span>
            </div>
          </SelectItem>
          {(Object.keys(TYPE_META) as ProjectType[]).map((t) => {
            const { label, description, Icon } = TYPE_META[t];
            return (
              <SelectItem key={t} value={t} textValue={label}>
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4" />
                  <div className="flex flex-col">
                    <span>{label}</span>
                    <span className="text-xs text-muted-foreground">{description}</span>
                  </div>
                </div>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
    </div>
  );
}
