import { describe, expect, it } from "vitest";

import { documentFileName, documentOutline } from "./outline";

describe("documentOutline", () => {
  it("lists headings in order with positional anchors", () => {
    const outline = documentOutline(
      [
        "# Solution overview",
        "",
        "Intro.",
        "",
        "## Goals",
        "### Must have",
        "#### Too deep",
        "## Goals",
      ].join("\n"),
    );
    expect(outline).toEqual([
      { id: "section-1", depth: 1, text: "Solution overview" },
      { id: "section-2", depth: 2, text: "Goals" },
      { id: "section-3", depth: 3, text: "Must have" },
      { id: "section-4", depth: 2, text: "Goals" },
    ]);
  });

  it("strips inline formatting and ignores headings inside code blocks", () => {
    const outline = documentOutline(
      [
        "## The **bold** `plan` [link](https://example.com)",
        "```",
        "# not a heading",
        "```",
      ].join("\n"),
    );
    expect(outline).toEqual([
      { id: "section-1", depth: 2, text: "The bold plan link" },
    ]);
  });

  it("returns nothing for a document without headings", () => {
    expect(documentOutline("Just a paragraph.")).toEqual([]);
  });
});

describe("documentFileName", () => {
  it("makes a safe file name", () => {
    expect(documentFileName('Solution "Überblick" / v2', "md")).toBe(
      "solution-uberblick-v2.md",
    );
    expect(documentFileName("???", "md")).toBe("document.md");
  });
});
