import { describe, it, expect } from "vitest";
import { parseSpecSections, hashParagraph } from "@/lib/specs/parse";

describe("hashParagraph", () => {
  it("returns a 16-char hex string", () => {
    const h = hashParagraph("hello world");
    expect(h).toMatch(/^[0-9a-f]{16}$/);
  });

  it("is stable for the same input", () => {
    expect(hashParagraph("hello world")).toBe(hashParagraph("hello world"));
  });

  it("differs for different inputs", () => {
    expect(hashParagraph("hello world")).not.toBe(hashParagraph("hello earth"));
  });

  it("trims whitespace before hashing", () => {
    expect(hashParagraph("hello")).toBe(hashParagraph("  hello\n"));
  });
});

describe("parseSpecSections", () => {
  it("returns empty for empty input", () => {
    expect(parseSpecSections("")).toEqual([]);
  });

  it("splits on level-2 headings", () => {
    const md = "## A\n\npara1\n\n## B\n\npara2";
    const sections = parseSpecSections(md);
    expect(sections).toHaveLength(2);
    expect(sections[0].heading).toBe("A");
    expect(sections[1].heading).toBe("B");
    expect(sections[0].paragraphs[0].text).toBe("para1");
    expect(sections[1].paragraphs[0].text).toBe("para2");
  });

  it("handles multiple paragraphs in a section", () => {
    const md = "## A\n\npara1\n\npara2\n\npara3";
    const sections = parseSpecSections(md);
    expect(sections[0].paragraphs).toHaveLength(3);
    expect(sections[0].paragraphs[1].text).toBe("para2");
    expect(sections[0].paragraphs[1].index).toBe(1);
  });

  it("attaches stable hashes to each paragraph", () => {
    const md = "## A\n\nfirst para\n\nsecond para";
    const sections = parseSpecSections(md);
    expect(sections[0].paragraphs[0].hash).toBe(hashParagraph("first para"));
    expect(sections[0].paragraphs[1].hash).toBe(hashParagraph("second para"));
  });

  it("ignores the trailing watermark HTML comment", () => {
    const md = "## A\n\npara1\n\n<!-- generated-by: x -->";
    const sections = parseSpecSections(md);
    expect(sections[0].paragraphs).toHaveLength(1);
    expect(sections[0].paragraphs[0].text).toBe("para1");
  });

  it("ignores content before the first level-2 heading", () => {
    const md = "preamble\n\n## A\n\npara1";
    const sections = parseSpecSections(md);
    expect(sections).toHaveLength(1);
    expect(sections[0].heading).toBe("A");
  });

  it("collapses multi-line paragraph content into one string", () => {
    const md = "## A\n\nline one\nline two\n\npara2";
    const sections = parseSpecSections(md);
    expect(sections[0].paragraphs).toHaveLength(2);
    expect(sections[0].paragraphs[0].text).toBe("line one\nline two");
  });

  it("returns sections with empty paragraph arrays when section has no body", () => {
    const md = "## A\n\n## B\n\npara2";
    const sections = parseSpecSections(md);
    expect(sections[0].heading).toBe("A");
    expect(sections[0].paragraphs).toEqual([]);
    expect(sections[1].paragraphs).toHaveLength(1);
  });
});
