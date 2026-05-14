import { createHash } from "node:crypto";

export type ParsedParagraph = {
  index: number;
  text: string;
  hash: string;
};

export type ParsedSection = {
  heading: string;
  paragraphs: ParsedParagraph[];
};

export function hashParagraph(text: string): string {
  return createHash("sha1").update(text.trim()).digest("hex").slice(0, 16);
}

const SECTION_RE = /^## (.+)$/;
const HTML_COMMENT_RE = /^<!--[\s\S]*-->$/;

export function parseSpecSections(markdown: string): ParsedSection[] {
  if (!markdown.trim()) return [];

  const lines = markdown.split("\n");
  const sections: ParsedSection[] = [];
  let currentHeading: string | null = null;
  let currentBuffer: string[] = [];

  function flushParagraph(target: ParsedParagraph[]) {
    const chunk = currentBuffer.join("\n").trim();
    currentBuffer = [];
    if (!chunk) return;
    if (HTML_COMMENT_RE.test(chunk)) return;
    target.push({
      index: target.length,
      text: chunk,
      hash: hashParagraph(chunk),
    });
  }

  function flushSection() {
    if (currentHeading === null) {
      currentBuffer = [];
      return;
    }
    const section: ParsedSection = { heading: currentHeading, paragraphs: [] };
    // Replay buffered lines as paragraphs, separated by blank lines.
    const buffered = currentBuffer;
    currentBuffer = [];
    for (const line of buffered) {
      if (line.trim() === "") {
        flushParagraph(section.paragraphs);
      } else {
        currentBuffer.push(line);
      }
    }
    flushParagraph(section.paragraphs);
    sections.push(section);
    currentHeading = null;
  }

  for (const line of lines) {
    const match = SECTION_RE.exec(line);
    if (match) {
      flushSection();
      currentHeading = match[1].trim();
      currentBuffer = [];
    } else if (currentHeading !== null) {
      currentBuffer.push(line);
    }
  }
  flushSection();

  return sections;
}
