import { describe, expect, it } from "vitest";

import {
  findMarkdownImages,
  isLocalImageDestination,
  rewriteMarkdownImages,
} from "./markdown-images.js";

function destinations(markdown: string): string[] {
  return findMarkdownImages(markdown).map((image) => image.destination);
}

describe("findMarkdownImages", () => {
  it("finds plain, titled, and angle-bracketed image destinations", () => {
    expect(
      destinations(
        [
          "Intro ![one](images/one.png) text",
          '![two](./two.jpg "A title")',
          "![three](<my image.webp> 'single')",
          "![four](four.gif (paren title))",
        ].join("\n"),
      ),
    ).toEqual(["images/one.png", "./two.jpg", "my image.webp", "four.gif"]);
  });

  it("finds several images on one line and reports positions", () => {
    const markdown = "![a](a.png) and ![b](b.png)";
    const images = findMarkdownImages(markdown);

    expect(images).toEqual([
      { line: 1, start: 5, end: 10, destination: "a.png" },
      { line: 1, start: 21, end: 26, destination: "b.png" },
    ]);
  });

  it("ignores ordinary links and empty destinations", () => {
    expect(destinations("[link](doc.md) ![]() ![alt]( )")).toEqual([]);
  });

  it("ignores backslash-escaped image syntax", () => {
    expect(destinations("\\![not](image.png)")).toEqual([]);
  });

  it("skips backtick fenced code blocks", () => {
    expect(
      destinations(
        [
          "![before](before.png)",
          "```markdown",
          "![inside](inside.png)",
          "```",
          "![after](after.png)",
        ].join("\n"),
      ),
    ).toEqual(["before.png", "after.png"]);
  });

  it("skips tilde fenced code blocks and honours fence length", () => {
    expect(
      destinations(
        [
          "~~~~",
          "![inside](inside.png)",
          "~~~",
          "![still inside](still.png)",
          "~~~~",
          "![after](after.png)",
        ].join("\n"),
      ),
    ).toEqual(["after.png"]);
  });

  it("does not close a backtick fence with a tilde fence", () => {
    expect(
      destinations(
        ["```", "~~~", "![inside](inside.png)", "```", "![after](after.png)"].join(
          "\n",
        ),
      ),
    ).toEqual(["after.png"]);
  });

  it("skips fenced code blocks in CRLF files and keeps offsets", () => {
    const markdown = [
      "![before](before.png)",
      "```",
      "![inside](inside.png)",
      "```",
      "~~~",
      "![tilde](tilde.png)",
      "~~~",
      "![after](after.png)",
    ].join("\r\n");
    const images = findMarkdownImages(markdown);

    expect(images.map((image) => image.destination)).toEqual([
      "before.png",
      "after.png",
    ]);
    expect(
      images.map((image) => markdown.slice(image.start, image.end)),
    ).toEqual(["before.png", "after.png"]);
    expect(
      rewriteMarkdownImages(markdown, (destination) =>
        destination === "after.png" ? "/api/assets/after.png" : null,
      ),
    ).toBe(markdown.replace("(after.png)", "(/api/assets/after.png)"));
  });

  it("treats an unterminated fence as running to the end", () => {
    expect(destinations("```\n![inside](inside.png)\n")).toEqual([]);
  });

  it("skips inline code spans, including multi-backtick spans", () => {
    expect(
      destinations(
        [
          "Use `![alt](in-code.png)` syntax ![real](real.png)",
          "``code with ` inside ![x](x.png)`` ![second](second.png)",
          "`unterminated ![y](y.png)",
        ].join("\n"),
      ),
    ).toEqual(["real.png", "second.png", "y.png"]);
  });

  it("keeps images with nested brackets in the alt text", () => {
    expect(destinations("![alt [nested]](nested.png)")).toEqual(["nested.png"]);
  });
});

describe("isLocalImageDestination", () => {
  it("skips http, https, data, and existing asset URLs", () => {
    expect(isLocalImageDestination("http://example.com/a.png")).toBe(false);
    expect(isLocalImageDestination("https://example.com/a.png")).toBe(false);
    expect(isLocalImageDestination("HTTPS://example.com/a.png")).toBe(false);
    expect(isLocalImageDestination("data:image/png;base64,AAAA")).toBe(false);
    expect(isLocalImageDestination("/api/assets/abc.png")).toBe(false);
    expect(isLocalImageDestination("//cdn.example.com/a.png")).toBe(false);
  });

  it("treats relative and absolute paths as local", () => {
    expect(isLocalImageDestination("images/a.png")).toBe(true);
    expect(isLocalImageDestination("./a.png")).toBe(true);
    expect(isLocalImageDestination("../a.png")).toBe(true);
    expect(isLocalImageDestination("/tmp/a.png")).toBe(true);
  });
});

describe("rewriteMarkdownImages", () => {
  it("replaces only the destinations the callback resolves", () => {
    const markdown = [
      "![local](a.png) ![remote](https://x/y.png)",
      "```",
      "![code](a.png)",
      "```",
      "![again](<a.png> \"t\")",
    ].join("\n");

    expect(
      rewriteMarkdownImages(markdown, (destination) =>
        destination === "a.png" ? "/api/assets/hash.png" : null,
      ),
    ).toBe(
      [
        "![local](/api/assets/hash.png) ![remote](https://x/y.png)",
        "```",
        "![code](a.png)",
        "```",
        "![again](</api/assets/hash.png> \"t\")",
      ].join("\n"),
    );
  });

  it("returns the input unchanged when nothing matches", () => {
    const markdown = "No images here.\n";
    expect(rewriteMarkdownImages(markdown, () => null)).toBe(markdown);
  });
});
