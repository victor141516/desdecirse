import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { desdecirse } from "../src/index";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;

  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

function wait(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runBunScript(source: string): Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
}> {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("bun", ["--cwd", root, "-e", source], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", rejectPromise);
    child.on("close", (code) => {
      resolvePromise({ code, stdout, stderr });
    });
  });
}

describe("desdecirse", () => {
  it("does not load until refresh is called", async () => {
    let loads = 0;
    let settled = false;

    const resource = desdecirse(async () => {
      loads += 1;
      return "ready";
    });

    const pending = resource.value().then((value) => {
      settled = true;
      return value;
    });

    await wait();

    expect(loads).toBe(0);
    expect(settled).toBe(false);

    resource.refresh();

    await expect(pending).resolves.toBe("ready");
    expect(loads).toBe(1);
    expect(settled).toBe(true);
  });

  it("returns the current value when no refresh is running", async () => {
    let next = 1;
    const resource = desdecirse(async () => next++);

    const pending = resource.value();
    resource.refresh();

    await expect(pending).resolves.toBe(1);
    await expect(resource.value()).resolves.toBe(1);
  });

  it("returns a fresh promise for each value call", async () => {
    const gate = deferred<string>();
    const resource = desdecirse(async () => gate.promise);

    resource.refresh();

    const firstPending = resource.value();
    const secondPending = resource.value();

    expect(firstPending).not.toBe(secondPending);

    gate.resolve("ready");

    await expect(firstPending).resolves.toBe("ready");
    await expect(secondPending).resolves.toBe("ready");

    const firstCurrent = resource.value();
    const secondCurrent = resource.value();

    expect(firstCurrent).not.toBe(secondCurrent);
    await expect(firstCurrent).resolves.toBe("ready");
    await expect(secondCurrent).resolves.toBe("ready");
  });

  it("updates the current value after a later refresh", async () => {
    let next = 1;
    const resource = desdecirse(async () => next++);

    const first = resource.value();
    resource.refresh();
    await expect(first).resolves.toBe(1);

    resource.refresh();
    const second = resource.value();

    await expect(second).resolves.toBe(2);
    await expect(resource.value()).resolves.toBe(2);
  });

  it("waits for the running refresh instead of returning the previous value", async () => {
    let next = 1;
    const gate = deferred<void>();
    const resource = desdecirse(async () => {
      if (next === 2) {
        await gate.promise;
      }

      return next++;
    });

    const first = resource.value();
    resource.refresh();
    await expect(first).resolves.toBe(1);

    resource.refresh();

    const duringRefresh = resource.value();
    let settled = false;
    duringRefresh.then(() => {
      settled = true;
    });

    await wait();

    expect(settled).toBe(false);

    gate.resolve();

    await expect(duringRefresh).resolves.toBe(2);
  });

  it("deduplicates refresh calls while a refresh is running", async () => {
    let loads = 0;
    const gate = deferred<void>();
    const resource = desdecirse(async () => {
      loads += 1;
      await gate.promise;
      return loads;
    });

    const pending = resource.value();

    resource.refresh();
    resource.refresh();
    resource.refresh();

    expect(loads).toBe(1);

    gate.resolve();

    await expect(pending).resolves.toBe(1);
    await expect(resource.value()).resolves.toBe(1);
  });

  it("rejects pending value promises when the first refresh fails", async () => {
    const error = new Error("load failed");
    const resource = desdecirse(async () => {
      throw error;
    });

    const pending = resource.value();
    pending.catch(() => {});

    resource.refresh();

    await expect(pending).rejects.toBe(error);
  });

  it("rejects pending value promises when a refresh fails with an old value available", async () => {
    let shouldFail = false;
    const resource = desdecirse(async () => {
      if (shouldFail) {
        throw new Error("refresh failed");
      }

      return "old";
    });

    const first = resource.value();
    resource.refresh();
    await expect(first).resolves.toBe("old");

    shouldFail = true;

    resource.refresh();
    const pending = resource.value();
    pending.catch(() => {});

    await expect(pending).rejects.toThrow("refresh failed");
    await expect(resource.value()).resolves.toBe("old");
  });

  it("does not report unhandled rejection when a value rejection is caught", async () => {
    const result = await runBunScript(`
      import { desdecirse } from "./src/index.ts";

      const resource = desdecirse(async () => {
        throw new Error("boom");
      });

      process.once("unhandledRejection", () => {
        process.exit(1);
      });

      resource.value().catch(() => {});
      resource.refresh();

      setTimeout(() => {
        process.exit(0);
      }, 50);
    `);

    expect(result).toEqual({ code: 0, stdout: "", stderr: "" });
  });

  it("reports unhandled rejection when a value rejection is not caught", async () => {
    const result = await runBunScript(`
      import { desdecirse } from "./src/index.ts";

      const resource = desdecirse(async () => {
        throw new Error("boom");
      });

      process.once("unhandledRejection", (reason) => {
        if (reason instanceof Error && reason.message === "boom") {
          process.exit(0);
        }

        process.exit(1);
      });

      resource.value();
      resource.refresh();

      setTimeout(() => {
        process.exit(1);
      }, 50);
    `);

    expect(result).toEqual({ code: 0, stdout: "", stderr: "" });
  });

  it("does not leak an internal unhandled rejection when nobody called value", async () => {
    const result = await runBunScript(`
      import { desdecirse } from "./src/index.ts";

      const resource = desdecirse(async () => {
        throw new Error("boom");
      });

      process.once("unhandledRejection", () => {
        process.exit(1);
      });

      resource.refresh();

      setTimeout(() => {
        process.exit(0);
      }, 50);
    `);

    expect(result).toEqual({ code: 0, stdout: "", stderr: "" });
  });
});
