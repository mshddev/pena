import { readFile } from "node:fs/promises";

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  process.stdout.write(
    [
      "Usage:",
      "  node publish-document.mjs --workspace <slug> --document <slug>",
      "    --title <title> --file <markdown-path> --create",
      "  node publish-document.mjs --workspace <slug> --document <slug>",
      "    --title <title> --file <markdown-path> --etag <etag>",
      "    [--feedback-match <batch-id>]",
      "    [--base-url <url>]",
      "",
    ].join("\n"),
  );
  process.exit(0);
}

const workspace = requireValue(args, "workspace");
const document = requireValue(args, "document");
const title = requireValue(args, "title").trim();
const file = requireValue(args, "file");
const create = args.create === true;
const etag = typeof args.etag === "string" ? args.etag : null;

if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(workspace)) {
  fail("The workspace slug is invalid.");
}

if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(document)) {
  fail("The document slug is invalid.");
}

if (title.length === 0 || title.length > 200) {
  fail("The title must contain 1 to 200 characters.");
}

if (create === (etag !== null)) {
  fail("Pass exactly one of --create or --etag.");
}

if (
  args["feedback-match"] !== undefined &&
  !/^[1-9]\d*$/.test(String(args["feedback-match"]))
) {
  fail("--feedback-match must be a positive feedback batch ID.");
}

let content;

try {
  content = await readFile(file, "utf8");
} catch (error) {
  fail(`Could not read the Markdown file: ${errorMessage(error)}`);
}

if (hasLeadingH1(content)) {
  fail(
    "The Markdown body must not repeat the document title as a leading H1.",
  );
}

const headers = {
  "content-type": "application/json",
  ...(create ? { "if-none-match": "*" } : { "if-match": etag }),
  ...(args["feedback-match"] === undefined
    ? {}
    : { "if-feedback-match": String(args["feedback-match"]) }),
};
const baseUrl =
  typeof args["base-url"] === "string"
    ? args["base-url"].replace(/\/+$/, "")
    : "http://127.0.0.1:8788";
const url =
  `${baseUrl}/api/workspaces/${encodeURIComponent(workspace)}` +
  `/documents/${encodeURIComponent(document)}`;

try {
  const response = await fetch(url, {
    method: "PUT",
    headers,
    body: JSON.stringify({ title, content }),
  });
  const responseText = await response.text();
  let body = null;

  if (responseText.length > 0) {
    try {
      body = JSON.parse(responseText);
    } catch {
      body = responseText;
    }
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        status: response.status,
        etag: response.headers.get("etag"),
        body,
      },
      null,
      2,
    )}\n`,
  );

  if (!response.ok) {
    process.exitCode = 1;
  }
} catch (error) {
  fail(`Could not reach Pena: ${errorMessage(error)}`);
}

function parseArgs(values) {
  const parsed = {};

  for (let index = 0; index < values.length; index += 1) {
    const argument = values[index];

    if (argument === "--help") {
      parsed.help = true;
      continue;
    }

    if (argument === "--create") {
      parsed.create = true;
      continue;
    }

    if (!argument?.startsWith("--")) {
      fail(`Unexpected argument: ${argument ?? ""}`);
    }

    const key = argument.slice(2);
    const value = values[index + 1];

    if (value === undefined || value.startsWith("--")) {
      fail(`Missing value for ${argument}.`);
    }

    parsed[key] = value;
    index += 1;
  }

  return parsed;
}

function requireValue(args, key) {
  const value = args[key];

  if (typeof value !== "string" || value.length === 0) {
    fail(`Missing --${key}.`);
  }

  return value;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function hasLeadingH1(content) {
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/);
  let index = 0;

  if (lines[0]?.trim() === "---") {
    index = 1;

    while (index < lines.length && lines[index]?.trim() !== "---") {
      index += 1;
    }

    if (index === lines.length) {
      return false;
    }

    index += 1;
  }

  while (index < lines.length && lines[index]?.trim() === "") {
    index += 1;
  }

  const firstLine = lines[index] ?? "";
  const secondLine = lines[index + 1] ?? "";

  return (
    /^ {0,3}#[\t ]+\S/.test(firstLine) ||
    (firstLine.trim().length > 0 && /^ {0,3}=+[\t ]*$/.test(secondLine))
  );
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
