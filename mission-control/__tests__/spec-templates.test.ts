import { describe, it, expect } from "vitest";
import { getTemplate, UNIVERSAL_SECTIONS, type SpecSection } from "@/lib/specs/templates";

describe("spec templates", () => {
  it("returns the software template by default when type is null", () => {
    const tmpl = getTemplate(null);
    expect(tmpl.type).toBe("software");
  });

  it("returns each type template", () => {
    expect(getTemplate("software").type).toBe("software");
    expect(getTemplate("content").type).toBe("content");
    expect(getTemplate("business").type).toBe("business");
  });

  it("includes all universal sections in every template", () => {
    for (const type of ["software", "content", "business"] as const) {
      const tmpl = getTemplate(type);
      const headings = tmpl.sections.map((s: SpecSection) => s.heading);
      for (const universal of UNIVERSAL_SECTIONS) {
        expect(headings).toContain(universal.heading);
      }
    }
  });

  it("software template has its specific sections", () => {
    const tmpl = getTemplate("software");
    const headings = tmpl.sections.map((s: SpecSection) => s.heading);
    expect(headings).toEqual(expect.arrayContaining([
      "Status snapshot", "Vision", "Feature set", "What's done",
      "In flight", "Planned", "Open questions", "Recent activity",
    ]));
  });

  it("content template has its specific sections", () => {
    const tmpl = getTemplate("content");
    const headings = tmpl.sections.map((s: SpecSection) => s.heading);
    expect(headings).toEqual(expect.arrayContaining([
      "Status snapshot", "Vision", "Pieces", "Themes / angles",
      "Pipeline", "Open questions", "Recent activity",
    ]));
  });

  it("business template has its specific sections", () => {
    const tmpl = getTemplate("business");
    const headings = tmpl.sections.map((s: SpecSection) => s.heading);
    expect(headings).toEqual(expect.arrayContaining([
      "Status snapshot", "Vision", "Goals", "Metrics",
      "Initiatives", "Decisions made", "Open questions", "Recent activity",
    ]));
  });

  it("orders software template sections: snapshot → vision → specific → open questions → recent activity", () => {
    const headings = getTemplate("software").sections.map((s) => s.heading);
    expect(headings).toEqual([
      "Status snapshot",
      "Vision",
      "Feature set",
      "What's done",
      "In flight",
      "Planned",
      "Open questions",
      "Recent activity",
    ]);
  });
});
