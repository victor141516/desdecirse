type Waiter<T> = {
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
};

export type RefreshableValue<T> = {
  value: () => Promise<T>;
  refresh: () => void;
};

export function desdecirse<T>(load: () => T | Promise<T>): RefreshableValue<T> {
  let current: T;
  let hasCurrent = false;
  let operation: Promise<void> | undefined;
  let waiters: Array<Waiter<T>> = [];

  function settleWaiters(settle: (waiter: Waiter<T>) => void): void {
    const pending = waiters;
    waiters = [];

    for (const waiter of pending) {
      settle(waiter);
    }
  }

  function value(): Promise<T> {
    if (!operation && hasCurrent) {
      return Promise.resolve(current);
    }

    return new Promise<T>((resolve, reject) => {
      waiters.push({ resolve, reject });
    });
  }

  function refresh(): void {
    if (operation) {
      return;
    }

    operation = (async () => {
      try {
        const next = await load();
        current = next;
        hasCurrent = true;
        settleWaiters((waiter) => waiter.resolve(next));
      } catch (error) {
        settleWaiters((waiter) => waiter.reject(error));
        throw error;
      } finally {
        operation = undefined;
      }
    })();

    void operation.catch(() => {
      // Users handle the promises returned by value(). This prevents the
      // internal operation from creating a second, unreachable rejection.
    });
  }

  return { value, refresh };
}
