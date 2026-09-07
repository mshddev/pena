export const EXIT_OK = 0;
export const EXIT_FAILURE = 1;
export const EXIT_USAGE = 2;
export const EXIT_PRECONDITION = 3;
export const EXIT_TIMEOUT = 4;

/** An error the CLI reports to the user and turns into an exit code. */
export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode: number,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = "CliError";
  }
}

export function usageError(message: string): CliError {
  return new CliError(message, EXIT_USAGE);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
