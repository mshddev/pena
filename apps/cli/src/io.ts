export interface Writer {
  write(chunk: string): unknown;
}

export interface Io {
  stdout: Writer;
  stderr: Writer;
  env: NodeJS.ProcessEnv;
  cwd: string;
  /** Aborts long-running commands (feedback watch, server start --foreground). */
  signal: AbortSignal;
}

export function resolveIo(io: Partial<Io> = {}): Io {
  return {
    stdout: io.stdout ?? process.stdout,
    stderr: io.stderr ?? process.stderr,
    env: io.env ?? process.env,
    cwd: io.cwd ?? process.cwd(),
    signal: io.signal ?? new AbortController().signal,
  };
}
