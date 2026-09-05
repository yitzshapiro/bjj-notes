import { describe, expect, it, vi } from "vitest";

import { mapConcurrent } from "./subtitle-concurrency";

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("mapConcurrent", () => {
  it("limits active work while preserving results and indices in input order", async () => {
    const gates = Array.from({ length: 4 }, () => deferred());
    const started: number[] = [];
    let active = 0;
    let maximumActive = 0;
    const result = mapConcurrent(["a", "b", "c", "d"], 2, async (item, index) => {
      started.push(index);
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await gates[index].promise;
      active -= 1;
      return `${item}:${index}`;
    }, new AbortController().signal);
    expect(started).toEqual([0, 1]);
    gates[1].resolve();
    await flushMicrotasks();
    expect(started).toEqual([0, 1, 2]);
    gates[2].resolve();
    await flushMicrotasks();
    expect(started).toEqual([0, 1, 2, 3]);
    gates[3].resolve();
    gates[0].resolve();
    await expect(result).resolves.toEqual(["a:0", "b:1", "c:2", "d:3"]);
    expect(maximumActive).toBe(2);
    expect(active).toBe(0);
  });

  it("stops scheduling after failure and drains other workers before rejecting", async () => {
    const gates = [deferred(), deferred(), deferred()];
    const failure = new Error("upload failed");
    const worker = vi.fn(async (_item: number, index: number) => {
      await gates[index].promise;
      return index;
    });
    let settled = false;
    const result = mapConcurrent([0, 1, 2, 3, 4], 3, worker, new AbortController().signal);
    const rejection = expect(result).rejects.toBe(failure);
    void result.then(() => { settled = true; }, () => { settled = true; });
    gates[0].reject(failure);
    await flushMicrotasks();
    expect(worker).toHaveBeenCalledTimes(3);
    expect(settled).toBe(false);
    gates[1].resolve();
    await flushMicrotasks();
    expect(worker).toHaveBeenCalledTimes(3);
    expect(settled).toBe(false);
    gates[2].reject(new Error("later failure"));
    await rejection;
    expect(settled).toBe(true);
    expect(worker).toHaveBeenCalledTimes(3);
  });

  it.each([undefined, null])("retains a first failure even when its thrown value is %s", async (failure) => {
    const gate = deferred();
    const worker = vi.fn(async (_item: number, index: number) => {
      if (index === 0) throw failure;
      await gate.promise;
      throw new Error("later failure");
    });
    const result = mapConcurrent([0, 1, 2], 2, worker, new AbortController().signal);
    const rejection = expect(result).rejects.toBe(failure);
    await flushMicrotasks();
    gate.resolve();
    await rejection;
    expect(worker).toHaveBeenCalledTimes(2);
  });

  it("does no work for an already aborted signal", async () => {
    const controller = new AbortController();
    const reason = new Error("cancelled before start");
    controller.abort(reason);
    const worker = vi.fn(async () => "unused");
    await expect(mapConcurrent([1, 2], 2, worker, controller.signal)).rejects.toBe(reason);
    expect(worker).not.toHaveBeenCalled();
  });

  it("drains running work after cancellation and does not schedule more items", async () => {
    const controller = new AbortController();
    const reason = new Error("user stopped job");
    const gates = [deferred(), deferred()];
    const worker = vi.fn(async (_item: number, index: number) => { await gates[index].promise; return index; });
    let settled = false;
    const result = mapConcurrent([0, 1, 2, 3], 2, worker, controller.signal);
    const rejection = expect(result).rejects.toBe(reason);
    void result.then(() => { settled = true; }, () => { settled = true; });
    controller.abort(reason);
    await flushMicrotasks();
    expect(settled).toBe(false);
    gates[0].resolve();
    await flushMicrotasks();
    expect(settled).toBe(false);
    expect(worker).toHaveBeenCalledTimes(2);
    gates[1].resolve();
    await rejection;
    expect(settled).toBe(true);
    expect(worker).toHaveBeenCalledTimes(2);
  });

  it("handles synchronous worker throws and removes its abort listener on failure", async () => {
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, "addEventListener");
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const worker = vi.fn((): Promise<never> => { throw new Error("synchronous failure"); });
    await expect(mapConcurrent([0, 1], 2, worker, controller.signal)).rejects.toThrow("synchronous failure");
    expect(worker).toHaveBeenCalledOnce();
    expect(add).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledWith("abort", add.mock.calls[0][1]);
  });

  it("removes its abort listener after successful work", async () => {
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, "addEventListener");
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    await expect(mapConcurrent([1, 2], 100, async (item) => item * 2, controller.signal)).resolves.toEqual([2, 4]);
    expect(add).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledWith("abort", add.mock.calls[0][1]);
  });

  it("returns empty work without adding a listener", async () => {
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, "addEventListener");
    const worker = vi.fn(async () => 1);
    await expect(mapConcurrent([], 2, worker, controller.signal)).resolves.toEqual([]);
    expect(worker).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
  });

  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("rejects invalid concurrency %s before work", async (concurrency) => {
    const worker = vi.fn(async () => 1);
    await expect(mapConcurrent([0], concurrency, worker, new AbortController().signal)).rejects.toThrow(/positive safe integer/);
    expect(worker).not.toHaveBeenCalled();
  });
});
