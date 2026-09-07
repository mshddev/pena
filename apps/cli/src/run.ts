import { parseInvocation, wantsJson } from "./args.js";
import { PenaClient, resolveBaseUrl } from "./client.js";
import { COMMAND_HANDLERS } from "./commands/index.js";
import {
  CliError,
  EXIT_FAILURE,
  EXIT_OK,
  errorMessage,
  usageError,
} from "./errors.js";
import { resolveIo, type Io } from "./io.js";

/**
 * Runs one CLI invocation and returns its exit code. Output goes to `io`, so
 * tests can run commands in-process.
 */
export async function run(
  argv: string[],
  io: Partial<Io> = {},
): Promise<number> {
  const resolved = resolveIo(io);
  let json = wantsJson(argv);

  try {
    const parsed = parseInvocation(argv);

    if (parsed.kind === "help") {
      resolved.stdout.write(parsed.text);
      return EXIT_OK;
    }

    const { invocation } = parsed;
    json = invocation.json;
    const baseUrl = resolveBaseUrl(invocation.url, resolved.env);
    const key = `${invocation.command.group} ${invocation.command.name}`;
    const handler = COMMAND_HANDLERS[key];

    if (!handler) {
      throw usageError(`The command "${key}" is not implemented.`);
    }

    const result = await handler({
      client: new PenaClient(baseUrl),
      baseUrl,
      io: resolved,
      json,
      values: invocation.values,
      positionals: invocation.positionals,
    });

    if (result) {
      resolved.stdout.write(
        json ? `${JSON.stringify(result.data, null, 2)}\n` : `${result.text}\n`,
      );
    }

    return EXIT_OK;
  } catch (error) {
    const failure =
      error instanceof CliError
        ? error
        : new CliError(errorMessage(error), EXIT_FAILURE);

    resolved.stderr.write(
      json
        ? `${JSON.stringify({ error: failure.message, status: failure.status })}\n`
        : `${failure.message}\n`,
    );

    return failure.exitCode;
  }
}
