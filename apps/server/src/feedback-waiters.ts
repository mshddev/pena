export type FeedbackWaitResult =
  | "notified"
  | "timeout"
  | "closed"
  | "cancelled";

export interface FeedbackWaitSubscription {
  result: Promise<FeedbackWaitResult>;
  cancel(): void;
}

type ResolveWait = (result: FeedbackWaitResult) => void;

export class FeedbackWaiters {
  readonly #waiters = new Map<string, Set<ResolveWait>>();
  #closed = false;

  subscribe(key: string, timeoutMs: number): FeedbackWaitSubscription {
    if (this.#closed) {
      return {
        result: Promise.resolve("closed"),
        cancel() {},
      };
    }

    let settled = false;
    let resolveResult: ResolveWait = () => {};
    const waitersForKey = this.#waiters.get(key) ?? new Set<ResolveWait>();
    this.#waiters.set(key, waitersForKey);

    const result = new Promise<FeedbackWaitResult>((resolve) => {
      resolveResult = resolve;
    });
    const finish = (waitResult: FeedbackWaitResult) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      waitersForKey.delete(finish);

      if (waitersForKey.size === 0) {
        this.#waiters.delete(key);
      }

      resolveResult(waitResult);
    };
    const timer = setTimeout(() => finish("timeout"), timeoutMs);
    timer.unref();
    waitersForKey.add(finish);

    return {
      result,
      cancel: () => finish("cancelled"),
    };
  }

  notify(key: string): void {
    for (const finish of [...(this.#waiters.get(key) ?? [])]) {
      finish("notified");
    }
  }

  close(): void {
    this.#closed = true;

    for (const waitersForKey of [...this.#waiters.values()]) {
      for (const finish of [...waitersForKey]) {
        finish("closed");
      }
    }
  }
}

export function feedbackWaitKey(
  workspaceSlug: string,
  documentSlug: string,
): string {
  return `${workspaceSlug}\0${documentSlug}`;
}
