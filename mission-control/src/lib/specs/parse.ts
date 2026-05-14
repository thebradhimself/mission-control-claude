export type ParsedParagraph = {
  index: number;
  text: string;
  hash: string;
};

export type ParsedSection = {
  heading: string;
  paragraphs: ParsedParagraph[];
};

/**
 * FNV-1a 64-bit hash implemented via two 32-bit halves.
 * Produces a stable 16-char lowercase hex string.
 * Browser-safe (no node:crypto).
 */
export function hashParagraph(text: string): string {
  const input = text.trim();
  // FNV offset basis split into two 32-bit halves (hi: 0xcbf29ce4, lo: 0x84222325 — note: actual 64-bit is 0xcbf29ce484222325)
  let hi = 0xcbf29ce4 >>> 0;
  let lo = 0x84222325 >>> 0;
  const FNV_PRIME_LO = 0x01000193 >>> 0; // lower 32 bits of FNV prime 1099511628211

  for (let i = 0; i < input.length; i++) {
    const byte = input.charCodeAt(i) & 0xff;
    lo ^= byte;
    // Multiply (hi, lo) by FNV_PRIME: (hi, lo) * prime
    // hi * prime may overflow but we mask to 32 bits
    const newLo = Math.imul(lo, FNV_PRIME_LO) >>> 0;
    const newHi = (Math.imul(hi, FNV_PRIME_LO) + Math.imul(lo >>> 16, 0x0100) + (newLo < lo ? 1 : 0)) >>> 0;
    lo = newLo;
    hi = newHi;
  }

  return hi.toString(16).padStart(8, "0") + lo.toString(16).padStart(8, "0");
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
