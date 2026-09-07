import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  PNG,
  closedPort,
  createDocument,
  documentEtag,
  makeTempDirectory,
  runCli,
  startApp,
  submitFeedback,
  type TestApp,
} from "../test/helpers.js";

let test: TestApp;
let directory: string;

beforeEach(async () => {
  test = await startApp();
  directory = makeTempDirectory("pena-cli-");
});

afterEach(async () => {
  await test.close();
  rmSync(directory, { recursive: true, force: true });
});

function cli(args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) {
  return runCli(args, { baseUrl: test.baseUrl, cwd: directory, ...options });
}

function writeMarkdown(name: string, content: string): string {
  const path = join(directory, name);
  writeFileSync(path, content);
  return path;
}

describe("usage errors", () => {
  it("prints help with exit 0", async () => {
    const result = await cli(["--help"]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("pena doc publish <file>");
  });

  it("accepts -h before and after the command words", async () => {
    for (const argv of [["-h"], ["doc", "-h"], ["doc", "show", "-h"]]) {
      const result = await cli(argv);
      expect(result.code, argv.join(" ")).toBe(0);
      expect(result.stdout, argv.join(" ")).toContain("Usage:");
    }
  });

  it("rejects unknown commands and options with exit 2", async () => {
    expect((await cli(["bogus"])).code).toBe(2);
    expect((await cli(["doc", "bogus"])).code).toBe(2);
    expect((await cli(["doc", "list", "--bogus"])).code).toBe(2);
    expect((await cli(["doc", "show"])).code).toBe(2);
    expect((await cli(["doc", "show", "a", "b"])).code).toBe(2);
    expect((await cli([])).code).toBe(2);
  });

  it("shapes usage errors as JSON when --json is passed", async () => {
    const result = await cli(["--json", "doc", "show", "Not A Slug"]);

    expect(result.code).toBe(2);
    expect(JSON.parse(result.stderr)).toEqual({
      error: expect.stringContaining("slug"),
      status: null,
    });
  });

  it("rejects an invalid Pena URL", async () => {
    const result = await runCli(["--url", "nope", "doc", "list"]);

    expect(result.code).toBe(2);
  });

  it("reports a Pena that is not running with exit 1", async () => {
    const port = await closedPort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const result = await runCli(["doc", "list"], { baseUrl });

    expect(result.code).toBe(1);
    expect(result.stderr).toBe(
      `Pena is not running at ${baseUrl}. Start it with \`pena server start\`.\n`,
    );
  });

  it("reads the base URL from PENA_URL", async () => {
    const result = await runCli(["doc", "list", "--json"], {
      env: { PENA_URL: `${test.baseUrl}/` },
    });

    expect(result.code).toBe(0);
    expect(result.json()).toEqual({ documents: [] });
  });
});

describe("asset upload", () => {
  it("uploads an image and prints its URL", async () => {
    const path = join(directory, "pixel.png");
    writeFileSync(path, PNG);

    const result = await cli(["asset", "upload", "pixel.png"]);

    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/^\/api\/assets\/[a-f0-9]{64}\.png\n$/);

    const json = await cli(["--json", "asset", "upload", path]);
    expect(json.json()).toMatchObject({ mediaType: "image/png", size: PNG.byteLength });
  });

  it("rejects unreadable and unsupported files with exit 2", async () => {
    expect((await cli(["asset", "upload", "missing.png"])).code).toBe(2);
    writeFileSync(join(directory, "notes.txt"), "hi");
    expect((await cli(["asset", "upload", "notes.txt"])).code).toBe(2);
  });

  it("reports a server-rejected image with exit 1", async () => {
    writeFileSync(join(directory, "fake.png"), "not a png");
    const result = await cli(["asset", "upload", "fake.png"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("PNG, JPEG, WebP, or GIF");
  });
});

describe("collections", () => {
  it("creates, lists, renames, and deletes collections", async () => {
    const created = await cli(["--json", "collection", "create", "Specs"]);
    expect(created.code).toBe(0);
    expect(created.json()).toMatchObject({ slug: "specs", name: "Specs", parentSlug: null });

    const child = await cli(["--json", "collection", "create", "Drafts", "--parent", "specs"]);
    expect(child.json()).toMatchObject({ slug: "drafts", parentSlug: "specs" });

    const list = await cli(["collection", "list"]);
    expect(list.code).toBe(0);
    expect(list.stdout).toContain("specs\tSpecs\tparent=root");
    expect(list.stdout).toContain("drafts\tDrafts\tparent=specs");

    const renamed = await cli(["--json", "collection", "rename", "drafts", "Draft Specs"]);
    expect(renamed.json()).toMatchObject({ slug: "drafts", name: "Draft Specs" });

    const deleted = await cli(["--json", "collection", "delete", "drafts"]);
    expect(deleted.code).toBe(0);
    expect(deleted.json()).toEqual({ deleted: true, slug: "drafts" });

    const listed = await cli(["--json", "collection", "list"]);
    expect(listed.json().collections.map((entry: { slug: string }) => entry.slug)).toEqual(["specs"]);
  });

  it("maps server conflicts to exit 1 with the server message", async () => {
    await cli(["collection", "create", "Specs"]);
    const result = await cli(["--json", "collection", "create", "Specs"]);

    expect(result.code).toBe(1);
    expect(JSON.parse(result.stderr)).toEqual({
      error: expect.stringContaining("already exists"),
      status: 409,
    });
  });
});

describe("doc publish", () => {
  it("creates a document, uploads local images, and leaves the source untouched", async () => {
    mkdirSync(join(directory, "images"));
    writeFileSync(join(directory, "images", "diagram.png"), PNG);
    const source = [
      "Opening prose.",
      "",
      "![Diagram](images/diagram.png)",
      "![Same](./images/diagram.png \"again\")",
      "![Remote](https://example.com/remote.png)",
      "![Uploaded](/api/assets/existing.png)",
      "",
      "```markdown",
      "![In code](images/missing.png)",
      "```",
      "",
      "Inline `![code](images/missing.png)` span.",
      "",
    ].join("\n");
    const path = writeMarkdown("spec.md", source);

    const result = await cli([
      "--json",
      "doc",
      "publish",
      path,
      "--slug",
      "initial-spec",
      "--title",
      "  Initial Specification  ",
    ]);

    expect(result.code).toBe(0);
    expect(result.json()).toEqual({
      slug: "initial-spec",
      title: "Initial Specification",
      version: 1,
      collectionSlug: null,
      archivedAt: null,
      etag: expect.stringMatching(/^".+"$/),
      url: `${test.baseUrl}/docs/initial-spec`,
      created: true,
      uploadedImages: [
        {
          path: join(directory, "images", "diagram.png"),
          url: expect.stringMatching(/^\/api\/assets\/[a-f0-9]{64}\.png$/),
        },
      ],
    });

    const assetUrl = result.json().uploadedImages[0].url;
    const shown = await cli(["--json", "doc", "show", "initial-spec"]);
    expect(shown.json().content).toBe(
      source
        .replace("images/diagram.png)", `${assetUrl})`)
        .replace("./images/diagram.png \"again\"", `${assetUrl} "again"`),
    );
    expect(shown.json().content).toContain("![In code](images/missing.png)");
    expect(shown.json().content).toContain("`![code](images/missing.png)`");
    expect(shown.json().etag).toBe(result.json().etag);
    expect(readFileSync(path, "utf8")).toBe(source);
  });

  it("updates an existing document with an automatic If-Match", async () => {
    const path = writeMarkdown("spec.md", "Version one.\n");
    const first = await cli(["--json", "doc", "publish", path, "--slug", "spec", "--title", "Spec"]);
    writeFileSync(path, "Version two.\n");
    const second = await cli(["--json", "doc", "publish", path, "--slug", "spec", "--title", "Spec"]);

    expect(first.json()).toMatchObject({ created: true, version: 1 });
    expect(second.json()).toMatchObject({ created: false, version: 2 });
    expect(second.json().etag).not.toBe(first.json().etag);

    const human = await cli(["doc", "publish", path, "--slug", "spec", "--title", "Spec"]);
    expect(human.stdout).toContain(`ETag: ${second.json().etag}`);
    expect(human.stdout).toContain(`URL: ${test.baseUrl}/docs/spec`);
  });

  it("uses --create and --etag as explicit preconditions", async () => {
    const path = writeMarkdown("spec.md", "Body.\n");
    const created = await cli(["--json", "doc", "publish", path, "--slug", "spec", "--title", "Spec", "--create"]);
    expect(created.json()).toMatchObject({ created: true });

    const duplicate = await cli(["--json", "doc", "publish", path, "--slug", "spec", "--title", "Spec", "--create"]);
    expect(duplicate.code).toBe(3);
    expect(JSON.parse(duplicate.stderr).status).toBe(412);

    writeFileSync(path, "Body two.\n");
    const updated = await cli(["--json", "doc", "publish", path, "--slug", "spec", "--title", "Spec", "--etag", created.json().etag]);
    expect(updated.code).toBe(0);
    expect(updated.json()).toMatchObject({ created: false, version: 2 });
    expect(updated.json().etag).not.toBe(created.json().etag);

    const stale = await cli(["doc", "publish", path, "--slug", "spec", "--title", "Renamed", "--etag", created.json().etag]);
    expect(stale.code).toBe(3);
    expect(stale.stderr).toContain("changed after it was read");
  });

  it("accepts an ETag without its surrounding quotes", async () => {
    const path = writeMarkdown("spec.md", "Body.\n");
    const created = await cli(["--json", "doc", "publish", path, "--slug", "spec", "--title", "Spec", "--create"]);
    const quoted: string = created.json().etag;
    expect(quoted).toMatch(/^"[^"]+"$/);

    writeFileSync(path, "Body two.\n");
    const bare = await cli(["--json", "doc", "publish", path, "--slug", "spec", "--title", "Spec", "--etag", quoted.slice(1, -1)]);
    expect(bare.stderr).toBe("");
    expect(bare.code).toBe(0);
    expect(bare.json()).toMatchObject({ version: 2 });

    const shown = await cli(["--json", "feedback", "show", "spec", "--etag", (bare.json().etag as string).slice(1, -1)]);
    expect(shown.code).toBe(0);
    expect(shown.json().etag).toBe(bare.json().etag);

    expect((await cli(["doc", "publish", path, "--slug", "spec", "--title", "Spec", "--etag", "  "])).code).toBe(2);
  });

  it("checks --feedback-match against the latest feedback batch", async () => {
    const path = writeMarkdown("spec.md", "Current draft\n");
    await cli(["doc", "publish", path, "--slug", "spec", "--title", "Spec"]);
    const batch = await submitFeedback(test, "spec");

    const mismatch = await cli(["doc", "publish", path, "--slug", "spec", "--title", "Spec", "--feedback-match", String(batch.id + 1)]);
    expect(mismatch.code).toBe(3);

    const match = await cli(["--json", "doc", "publish", path, "--slug", "spec", "--title", "Spec v2", "--feedback-match", String(batch.id)]);
    expect(match.code).toBe(0);
    expect(match.json()).toMatchObject({ version: 2, title: "Spec v2" });
  });

  it("files the document in a collection or at the root", async () => {
    await cli(["collection", "create", "Specs"]);
    const path = writeMarkdown("spec.md", "Body.\n");
    const filed = await cli(["--json", "doc", "publish", path, "--slug", "spec", "--title", "Spec", "--collection", "specs"]);
    expect(filed.json()).toMatchObject({ collectionSlug: "specs" });

    const stays = await cli(["--json", "doc", "publish", path, "--slug", "spec", "--title", "Spec"]);
    expect(stays.json()).toMatchObject({ collectionSlug: "specs" });

    const rooted = await cli(["--json", "doc", "publish", path, "--slug", "spec", "--title", "Spec", "--root"]);
    expect(rooted.json()).toMatchObject({ collectionSlug: null });

    const refiled = await cli(["--json", "doc", "publish", path, "--slug", "spec", "--title", "Spec", "--collection", "specs"]);
    expect(refiled.json()).toMatchObject({ collectionSlug: "specs" });

    // `--collection root` is the spelling `doc list` and `doc move` accept.
    const rootedAgain = await cli(["--json", "doc", "publish", path, "--slug", "spec", "--title", "Spec", "--collection", "root"]);
    expect(rootedAgain.stderr).toBe("");
    expect(rootedAgain.json()).toMatchObject({ collectionSlug: null });

    const missing = await cli(["doc", "publish", path, "--slug", "spec", "--title", "Spec", "--collection", "nope"]);
    expect(missing.code).toBe(1);
  });

  it("rejects bad input before publishing with exit 2", async () => {
    const path = writeMarkdown("spec.md", "Body.\n");
    const publish = (extra: string[]) =>
      cli(["doc", "publish", path, "--slug", "spec", "--title", "Spec", ...extra]);

    expect((await publish(["--collection", "specs", "--root"])).code).toBe(2);
    expect((await publish(["--create", "--etag", '"x"'])).code).toBe(2);
    expect((await publish(["--feedback-match", "0"])).code).toBe(2);
    expect((await cli(["doc", "publish", path, "--slug", "Bad Slug", "--title", "Spec"])).code).toBe(2);
    expect((await cli(["doc", "publish", path, "--slug", "spec", "--title", "   "])).code).toBe(2);
    expect((await cli(["doc", "publish", path, "--slug", "spec"])).code).toBe(2);
    expect((await cli(["doc", "publish", "missing.md", "--slug", "spec", "--title", "Spec"])).code).toBe(2);

    const h1 = writeMarkdown("h1.md", "---\ntitle: x\n---\n\n# Spec\n\nBody.\n");
    const rejected = await cli(["doc", "publish", h1, "--slug", "spec", "--title", "Spec"]);
    expect(rejected.code).toBe(2);
    expect(rejected.stderr).toContain("leading H1");

    const setext = writeMarkdown("setext.md", "Spec\n====\n\nBody.\n");
    expect((await cli(["doc", "publish", setext, "--slug", "spec", "--title", "Spec"])).code).toBe(2);

    expect((await cli(["--json", "doc", "list"])).json()).toEqual({ documents: [] });
  });

  it("fails before publishing when an image is missing, unsupported, or rejected", async () => {
    const missing = writeMarkdown("missing.md", "![x](nope.png)\n");
    const missingResult = await cli(["doc", "publish", missing, "--slug", "spec", "--title", "Spec"]);
    expect(missingResult.code).toBe(2);
    expect(missingResult.stderr).toContain("nope.png");

    writeFileSync(join(directory, "notes.txt"), "text");
    const unsupported = writeMarkdown("unsupported.md", "![x](notes.txt)\n");
    expect((await cli(["doc", "publish", unsupported, "--slug", "spec", "--title", "Spec"])).code).toBe(2);

    writeFileSync(join(directory, "fake.png"), "not a png");
    const rejected = writeMarkdown("rejected.md", "![x](fake.png)\n");
    expect((await cli(["doc", "publish", rejected, "--slug", "spec", "--title", "Spec"])).code).toBe(1);

    expect((await cli(["--json", "doc", "list"])).json()).toEqual({ documents: [] });
  });

  it("leaves image destinations alone with --no-images", async () => {
    const path = writeMarkdown("spec.md", "![x](nope.png)\n");
    const result = await cli(["--json", "doc", "publish", path, "--slug", "spec", "--title", "Spec", "--no-images"]);

    expect(result.code).toBe(0);
    expect(result.json().uploadedImages).toEqual([]);
    expect((await cli(["--json", "doc", "show", "spec"])).json().content).toBe("![x](nope.png)\n");
  });
});

describe("doc commands", () => {
  it("lists, shows, renames, moves, versions, and restores documents", async () => {
    await cli(["collection", "create", "Specs"]);
    await createDocument(test, "spec", "Body one.", "Spec");

    const shown = await cli(["doc", "show", "spec"]);
    expect(shown.code).toBe(0);
    expect(shown.stdout).toContain("Title: Spec");
    expect(shown.stdout).toContain(`ETag: ${await documentEtag(test, "spec")}`);
    expect(shown.stdout).toContain("Body one.");

    const renamed = await cli(["--json", "doc", "rename", "spec", "Spec Two"]);
    expect(renamed.code).toBe(0);
    expect(renamed.json()).toMatchObject({ title: "Spec Two", version: 2, etag: expect.any(String) });

    const moved = await cli(["--json", "doc", "move", "spec", "--to", "specs"]);
    expect(moved.json()).toMatchObject({ collectionSlug: "specs", etag: expect.any(String) });

    const inCollection = await cli(["--json", "doc", "list", "--collection", "specs"]);
    expect(inCollection.json().documents.map((entry: { slug: string }) => entry.slug)).toEqual(["spec"]);
    const atRoot = await cli(["--json", "doc", "list", "--collection", "root"]);
    expect(atRoot.json().documents).toEqual([]);

    const backToRoot = await cli(["--json", "doc", "move", "spec", "--to", "root"]);
    expect(backToRoot.json()).toMatchObject({ collectionSlug: null });

    const versions = await cli(["--json", "doc", "versions", "spec"]);
    expect(versions.json().versions.map((entry: { version: number }) => entry.version)).toEqual([2, 1]);

    const versionOne = await cli(["--json", "doc", "show", "spec", "--version", "1"]);
    expect(versionOne.json()).toMatchObject({ version: 1, title: "Spec", content: "Body one." });

    const restored = await cli(["--json", "doc", "restore", "spec", "1"]);
    expect(restored.code).toBe(0);
    expect(restored.json()).toMatchObject({ version: 3, title: "Spec", etag: expect.any(String) });

    const humanList = await cli(["doc", "list"]);
    expect(humanList.stdout).toBe("spec\tv3\troot\tSpec\n");
  });

  it("archives and unarchives documents", async () => {
    await createDocument(test, "spec");

    const archived = await cli(["--json", "doc", "archive", "spec"]);
    expect(archived.code).toBe(0);
    expect(archived.json()).toMatchObject({ archivedAt: expect.any(String), etag: expect.any(String) });

    expect((await cli(["--json", "doc", "list"])).json().documents).toEqual([]);
    const archive = await cli(["--json", "doc", "list", "--archived"]);
    expect(archive.json().documents.map((entry: { slug: string }) => entry.slug)).toEqual(["spec"]);

    const unarchived = await cli(["--json", "doc", "unarchive", "spec"]);
    expect(unarchived.json()).toMatchObject({ archivedAt: null });
    expect((await cli(["--json", "doc", "list", "--archived"])).json().documents).toEqual([]);
  });

  it("maps a missing document to exit 1 and bad arguments to exit 2", async () => {
    expect((await cli(["doc", "show", "missing"])).code).toBe(1);
    expect((await cli(["doc", "show", "spec", "--version", "x"])).code).toBe(2);
    expect((await cli(["doc", "move", "spec"])).code).toBe(2);
    expect((await cli(["doc", "move", "spec", "--to", "Bad!"])).code).toBe(2);
    expect((await cli(["doc", "restore", "spec", "0"])).code).toBe(2);
    expect((await cli(["doc", "list", "--collection", "Bad!"])).code).toBe(2);
  });
});

describe("feedback", () => {
  it("shows feedback with the document ETag", async () => {
    await createDocument(test, "spec");
    const empty = await cli(["--json", "feedback", "show", "spec"]);
    expect(empty.code).toBe(0);
    expect(empty.json()).toEqual({ latestBatchId: null, batches: [], etag: expect.any(String) });

    const batch = await submitFeedback(test, "spec", "Tighten this.");
    const shown = await cli(["feedback", "show", "spec"]);
    expect(shown.code).toBe(0);
    expect(shown.stdout).toContain(`Batch ${batch.id}`);
    expect(shown.stdout).toContain('"Current": Tighten this.');

    const stale = await cli(["--json", "feedback", "show", "spec", "--etag", '"stale"']);
    expect(stale.code).toBe(3);
    expect(JSON.parse(stale.stderr).status).toBe(412);

    const withEtag = await cli(["--json", "feedback", "show", "spec", "--etag", empty.json().etag]);
    expect(withEtag.code).toBe(0);
    expect(withEtag.json().latestBatchId).toBe(batch.id);
  });

  it("waits for feedback and exits 4 on timeout", async () => {
    await createDocument(test, "spec");
    const batch = await submitFeedback(test, "spec");

    const immediate = await cli(["--json", "feedback", "wait", "spec"]);
    expect(immediate.code).toBe(0);
    expect(immediate.json()).toMatchObject({
      documentSlug: "spec",
      documentVersion: 1,
      latestBatchId: batch.id,
      batches: [{ id: batch.id }],
    });

    const timedOut = await cli(["--json", "feedback", "wait", "spec", "--after", String(batch.id), "--timeout", "50"]);
    expect(timedOut.code).toBe(4);
    expect(JSON.parse(timedOut.stderr)).toEqual({ error: expect.stringContaining("No new feedback"), status: 204 });

    expect((await cli(["feedback", "wait", "spec", "--after", "-1"])).code).toBe(2);
    expect((await cli(["feedback", "wait", "spec", "--timeout", "0"])).code).toBe(2);
    expect((await cli(["feedback", "wait", "missing"])).code).toBe(1);
  });

  it("exits 0 quietly when feedback wait is aborted", async () => {
    await createDocument(test, "spec");
    const controller = new AbortController();
    const run = runCli(["feedback", "wait", "spec", "--timeout", "5000"], {
      baseUrl: test.baseUrl,
      signal: controller.signal,
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    controller.abort();
    const result = await run;

    expect(result.code).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });

  it("watches feedback in-process and stops when aborted", async () => {
    await createDocument(test, "spec");
    const controller = new AbortController();
    const run = runCli(["feedback", "watch", "spec"], {
      baseUrl: test.baseUrl,
      signal: controller.signal,
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    const batch = await submitFeedback(test, "spec");
    await new Promise((resolve) => setTimeout(resolve, 200));
    controller.abort();
    const result = await run;

    expect(result.code).toBe(0);
    expect(result.stdout).toBe(
      `${JSON.stringify({
        type: "pena_feedback_submitted",
        documentSlug: "spec",
        documentVersion: 1,
        latestBatchId: batch.id,
        batchIds: [batch.id],
      })}\n`,
    );
  });
});

describe("skill install", () => {
  it("copies the skill into the target directory, replacing what is there", async () => {
    const skills = join(directory, "skills");
    mkdirSync(join(skills, "pena"), { recursive: true });
    writeFileSync(join(skills, "pena", "stale.txt"), "old");

    const result = await cli(["--json", "skill", "install", "--dir", skills]);

    expect(result.code).toBe(0);
    expect(result.json()).toEqual({ path: join(skills, "pena") });
    expect(existsSync(join(skills, "pena", "SKILL.md"))).toBe(true);
    expect(existsSync(join(skills, "pena", "stale.txt"))).toBe(false);
  });

  it("refuses to install the skill over its own source", async () => {
    const source = fileURLToPath(new URL("../../../resources/skills", import.meta.url));

    const result = await cli(["skill", "install", "--dir", source]);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain("own source directory");
    expect(existsSync(join(source, "pena", "SKILL.md"))).toBe(true);
  });
});
