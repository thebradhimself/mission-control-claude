import type { ProjectType } from "@/lib/types";

export type SpecSection = {
  heading: string;
  guidance: string; // What this section should contain, sent to AI as part of the prompt
};

export type SpecTemplate = {
  type: ProjectType;
  sections: SpecSection[];
};

export const UNIVERSAL_SECTIONS: SpecSection[] = [
  {
    heading: "Status snapshot",
    guidance: "One paragraph: where the project is right now. Mention task counts (done / in flight / blocked / planned), progress percent, the most recent meaningful change, and the freshness of the data.",
  },
  {
    heading: "Open questions",
    guidance: "Bullet list of unresolved questions you noticed: pending decisions from decisions.json, items the data doesn't answer, ambiguity in task scope. Pull pending decisions verbatim where relevant.",
  },
  {
    heading: "Recent activity",
    guidance: "Five-bullet summary of meaningful activity from the last 7 days, drawn from activity-log entries scoped to this project. Each bullet: date · what happened · who.",
  },
];

const SOFTWARE_SPECIFIC: SpecSection[] = [
  { heading: "Vision", guidance: "Two to four sentences on what this project is and why it exists. Infer from project description and linked long-term goals. Be explicit when the data is thin." },
  { heading: "Feature set", guidance: "List capabilities, each tagged [shipped] [in-flight] [planned] [deferred]. Group logically, not chronologically. Derive from completed and in-progress tasks." },
  { heading: "What's done", guidance: "Recently completed tasks and milestones, grouped by theme. Include dates when notable." },
  { heading: "In flight", guidance: "In-progress tasks with assigned agent and freshness (last update). Flag anything stale (>3 days no update)." },
  { heading: "Planned", guidance: "Not-started tasks ordered by Eisenhower importance × urgency. Top 10 only." },
];

const CONTENT_SPECIFIC: SpecSection[] = [
  { heading: "Vision", guidance: "Two to four sentences on what this content project is about — the audience, voice, and goal." },
  { heading: "Pieces", guidance: "List of individual pieces of content with status (drafting / editing / published / paused). Derive from tasks." },
  { heading: "Themes / angles", guidance: "Recurring themes or angles being explored. Synthesize from titles and descriptions." },
  { heading: "Pipeline", guidance: "Funnel view: drafting → editing → published. Show counts at each stage." },
];

const BUSINESS_SPECIFIC: SpecSection[] = [
  { heading: "Vision", guidance: "Two to four sentences on the strategic intent — what this initiative is meant to achieve." },
  { heading: "Goals", guidance: "Linked long-term goals and their progress. Include timeframes." },
  { heading: "Metrics", guidance: "Quantitative measures relevant to this project. If none are tracked, say so explicitly." },
  { heading: "Initiatives", guidance: "Active workstreams — group in-progress tasks by initiative theme." },
  { heading: "Decisions made", guidance: "Recently answered decisions from decisions.json relevant to this project, with the chosen answer and date." },
];

function assemble(type: ProjectType, specific: SpecSection[]): SpecTemplate {
  // Order: snapshot · vision (specific) · the rest of specific · open questions · recent activity
  const snapshot = UNIVERSAL_SECTIONS[0];
  const openQuestions = UNIVERSAL_SECTIONS[1];
  const recentActivity = UNIVERSAL_SECTIONS[2];
  return {
    type,
    sections: [snapshot, ...specific, openQuestions, recentActivity],
  };
}

const TEMPLATES: Record<ProjectType, SpecTemplate> = {
  software: assemble("software", SOFTWARE_SPECIFIC),
  content: assemble("content", CONTENT_SPECIFIC),
  business: assemble("business", BUSINESS_SPECIFIC),
};

export function getTemplate(type: ProjectType | null): SpecTemplate {
  return TEMPLATES[type ?? "software"];
}
