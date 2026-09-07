import { cpSync, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

import { CliError, EXIT_FAILURE, usageError } from "../errors.js";
import { defaultSkillsDirectory, skillSourcePath } from "../paths.js";
import { stringOption, type CommandHandler } from "./context.js";

export const skillInstall: CommandHandler = async (context) => {
  const dirOption = stringOption(context, "dir");
  const directory =
    dirOption === undefined
      ? defaultSkillsDirectory()
      : resolve(context.io.cwd, dirOption);

  if (!existsSync(join(skillSourcePath, "SKILL.md"))) {
    throw new CliError(
      `The Pena skill source is missing at ${skillSourcePath}.`,
      EXIT_FAILURE,
    );
  }

  const target = join(directory, "pena");

  if (resolve(target) === resolve(skillSourcePath)) {
    throw usageError(
      `--dir ${directory} is the skill's own source directory; pass the skills directory to install into (default ~/.claude/skills).`,
    );
  }

  mkdirSync(directory, { recursive: true });
  // Stage the copy beside the target so a failed copy never leaves the
  // target half removed, then swap it in.
  const staging = `${target}.installing-${process.pid}`;
  rmSync(staging, { recursive: true, force: true });

  try {
    cpSync(skillSourcePath, staging, { recursive: true });
    rmSync(target, { recursive: true, force: true });
    renameSync(staging, target);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }

  return {
    data: { path: target },
    text: `Installed the Pena skill at ${target}`,
  };
};
