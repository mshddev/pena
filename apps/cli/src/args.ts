import { parseArgs, type ParseArgsConfig } from "node:util";

import { usageError } from "./errors.js";

type OptionSpecs = NonNullable<ParseArgsConfig["options"]>;

export type OptionValues = Record<string, string | boolean | undefined>;

export interface CommandSpec {
  group: string;
  name: string;
  /** Positional argument names. */
  positionals: string[];
  options: OptionSpecs;
  /** Option summary shown in the usage text. */
  summary: string;
}

export interface Invocation {
  command: CommandSpec;
  values: OptionValues;
  positionals: string[];
  json: boolean;
  url: string | undefined;
}

const GLOBAL_OPTIONS: OptionSpecs = {
  url: { type: "string" },
  json: { type: "boolean" },
  help: { type: "boolean" },
};

const string = { type: "string" } as const;
const boolean = { type: "boolean" } as const;

export const COMMANDS: CommandSpec[] = [
  {
    group: "server",
    name: "start",
    positionals: [],
    options: { port: string, foreground: boolean },
    summary: "[--port <n>] [--foreground]",
  },
  { group: "server", name: "stop", positionals: [], options: {}, summary: "" },
  {
    group: "server",
    name: "status",
    positionals: [],
    options: {},
    summary: "",
  },
  {
    group: "asset",
    name: "upload",
    positionals: ["file"],
    options: {},
    summary: "",
  },
  {
    group: "collection",
    name: "list",
    positionals: [],
    options: {},
    summary: "",
  },
  {
    group: "collection",
    name: "create",
    positionals: ["name"],
    options: { parent: string },
    summary: "[--parent <slug>]",
  },
  {
    group: "collection",
    name: "rename",
    positionals: ["slug", "name"],
    options: {},
    summary: "",
  },
  {
    group: "collection",
    name: "delete",
    positionals: ["slug"],
    options: {},
    summary: "",
  },
  {
    group: "doc",
    name: "list",
    positionals: [],
    options: { collection: string, archived: boolean },
    summary: "[--collection <slug|root>] [--archived]",
  },
  {
    group: "doc",
    name: "show",
    positionals: ["slug"],
    options: { version: string },
    summary: "[--version <n>]",
  },
  {
    group: "doc",
    name: "publish",
    positionals: ["file"],
    options: {
      slug: string,
      title: string,
      collection: string,
      root: boolean,
      etag: string,
      create: boolean,
      "feedback-match": string,
      "no-images": boolean,
    },
    summary:
      "--slug <slug> --title <title> [--collection <slug|root> | --root] [--etag <etag>] [--create] [--feedback-match <batch-id>] [--no-images]",
  },
  {
    group: "doc",
    name: "rename",
    positionals: ["slug", "title"],
    options: {},
    summary: "",
  },
  {
    group: "doc",
    name: "move",
    positionals: ["slug"],
    options: { to: string },
    summary: "--to <collection-slug|root>",
  },
  {
    group: "doc",
    name: "archive",
    positionals: ["slug"],
    options: {},
    summary: "",
  },
  {
    group: "doc",
    name: "unarchive",
    positionals: ["slug"],
    options: {},
    summary: "",
  },
  {
    group: "doc",
    name: "versions",
    positionals: ["slug"],
    options: {},
    summary: "",
  },
  {
    group: "doc",
    name: "restore",
    positionals: ["slug", "version"],
    options: {},
    summary: "",
  },
  {
    group: "feedback",
    name: "show",
    positionals: ["slug"],
    options: { etag: string },
    summary: "[--etag <etag>]",
  },
  {
    group: "feedback",
    name: "wait",
    positionals: ["slug"],
    options: { after: string, timeout: string },
    summary: "[--after <batch-id>] [--timeout <ms>]",
  },
  {
    group: "feedback",
    name: "watch",
    positionals: ["slug"],
    options: { after: string },
    summary: "[--after <batch-id>]",
  },
  {
    group: "skill",
    name: "install",
    positionals: [],
    options: { dir: string },
    summary: "[--dir <skills-dir>]",
  },
];

export function usageText(group?: string): string {
  const commands = COMMANDS.filter(
    (command) => group === undefined || command.group === group,
  );
  const lines = commands.map((command) =>
    [
      `  pena ${command.group} ${command.name}`,
      ...command.positionals.map((name) => `<${name}>`),
      command.summary,
    ]
      .filter((part) => part.length > 0)
      .join(" "),
  );

  return [
    "Usage: pena [--url <base>] [--json] <command> [options]",
    "",
    "Commands:",
    ...lines,
    "",
    "Global options:",
    "  --url <base>   Pena base URL (default: $PENA_URL or http://127.0.0.1:8788)",
    "  --json         Print the raw JSON result on stdout",
    "  --help         Show this help",
    "",
  ].join("\n");
}

export type ParseResult =
  | { kind: "help"; text: string }
  | { kind: "command"; invocation: Invocation };

/** Whether `--json` appears anywhere, so errors raised before parsing finishes use the JSON shape. */
export function wantsJson(argv: string[]): boolean {
  for (const argument of argv) {
    if (argument === "--") {
      return false;
    }

    if (argument === "--json") {
      return true;
    }
  }

  return false;
}

export function parseInvocation(argv: string[]): ParseResult {
  const words: string[] = [];
  let help = false;

  for (let index = 0; index < argv.length && words.length < 2; index += 1) {
    const argument = argv[index] ?? "";

    if (argument === "--") {
      break;
    }

    if (argument === "--help" || argument === "-h") {
      help = true;
      continue;
    }

    if (argument === "--json") {
      continue;
    }

    if (argument === "--url") {
      index += 1;
      continue;
    }

    if (argument.startsWith("--url=")) {
      continue;
    }

    if (argument.startsWith("-")) {
      throw usageError(
        `Unknown option "${argument}". Put command options after the command name.\n\n${usageText()}`,
      );
    }

    words.push(argument);
  }

  const [group, name] = words;

  if (help && group === undefined) {
    return { kind: "help", text: usageText() };
  }

  if (group === undefined) {
    throw usageError(usageText());
  }

  const groupCommands = COMMANDS.filter((command) => command.group === group);

  if (groupCommands.length === 0) {
    throw usageError(`Unknown command "${group}".\n\n${usageText()}`);
  }

  if (help && name === undefined) {
    return { kind: "help", text: usageText(group) };
  }

  const command = groupCommands.find((candidate) => candidate.name === name);

  if (!command) {
    throw usageError(
      name === undefined
        ? `Missing subcommand for "${group}".\n\n${usageText(group)}`
        : `Unknown command "${group} ${name}".\n\n${usageText(group)}`,
    );
  }

  let parsed: ReturnType<typeof parseArgs>;

  try {
    parsed = parseArgs({
      args: argv,
      options: { ...GLOBAL_OPTIONS, ...command.options },
      allowPositionals: true,
      strict: true,
    });
  } catch (error) {
    throw usageError(
      `${error instanceof Error ? error.message : String(error)}\n\n${usageText(group)}`,
    );
  }

  if (parsed.values.help === true) {
    return { kind: "help", text: usageText(group) };
  }

  const positionals = parsed.positionals.slice(2);

  if (positionals.length < command.positionals.length) {
    const missing = command.positionals[positionals.length] ?? "argument";
    throw usageError(
      `Missing <${missing}> for "pena ${group} ${name}".\n\n${usageText(group)}`,
    );
  }

  if (positionals.length > command.positionals.length) {
    throw usageError(
      `Unexpected argument "${positionals[command.positionals.length] ?? ""}".\n\n${usageText(group)}`,
    );
  }

  const values: OptionValues = {};

  for (const [key, value] of Object.entries(parsed.values)) {
    if (typeof value === "string" || typeof value === "boolean") {
      values[key] = value;
    }
  }

  return {
    kind: "command",
    invocation: {
      command,
      values,
      positionals,
      json: values.json === true,
      url: typeof values.url === "string" ? values.url : undefined,
    },
  };
}
