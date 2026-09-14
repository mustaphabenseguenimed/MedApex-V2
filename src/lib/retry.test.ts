import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { isRetryable, pickConcurrency, retryDelays } from "./retry";

/** A DOMException-shaped failure, as fetch and AbortSignal produce. */
const domError = (name: string, message: string) => Object.assign(new Error(message), { name });

describe("isRetryable", () => {
  // A phone losing its connection mid-upload is the case this exists for.
  test("a dropped connection is worth another try", () => {
    assert.equal(isRetryable(new TypeError("Failed to fetch")), true);
    assert.equal(isRetryable(new Error("NetworkError when attempting to fetch resource")), true);
    assert.equal(isRetryable(new Error("Load failed")), true);
  });

  test("a request the platform timed out is worth another try", () => {
    assert.equal(isRetryable(domError("TimeoutError", "signal timed out")), true);
    assert.equal(
      isRetryable(domError("AbortError", "The operation was aborted due to timeout")),
      true,
    );
  });

  // Cancel means cancel: the admin pressed the button, so nothing is resent.
  test("the admin's own cancel is never retried", () => {
    assert.equal(isRetryable(domError("AbortError", "The user aborted a request")), false);
    assert.equal(isRetryable(new TypeError("Failed to fetch"), true), false);
    assert.equal(isRetryable(domError("TimeoutError", "signal timed out"), true), false);
  });

  test("an answer from the server is not a network failure", () => {
    assert.equal(isRetryable(new Error("Request Entity Too Large")), false);
    assert.equal(isRetryable(new Error("429 Too Many Requests")), false, "cooldown handles this");
    assert.equal(isRetryable(new Error("L'IA n'a pas pu structurer la réponse")), false);
  });

  test("nothing useful in, false out", () => {
    assert.equal(isRetryable(null), false);
    assert.equal(isRetryable(undefined), false);
    assert.equal(isRetryable("boom"), false);
  });
});

describe("retryDelays", () => {
  test("backs off long enough for a cell handover", () => {
    assert.deepEqual(retryDelays(3), [2000, 4000, 8000]);
  });

  test("scales with the number of attempts asked for", () => {
    assert.deepEqual(retryDelays(1), [2000]);
    assert.deepEqual(retryDelays(0), []);
    assert.deepEqual(retryDelays(-1), []);
  });
});

describe("pickConcurrency", () => {
  test("a good connection carries four at a time", () => {
    assert.equal(pickConcurrency({ effectiveType: "4g" }), 4);
  });

  test("a slow connection keeps two", () => {
    assert.equal(pickConcurrency({ effectiveType: "3g" }), 2);
    assert.equal(pickConcurrency({ effectiveType: "2g" }), 2);
    assert.equal(pickConcurrency({ effectiveType: "slow-2g" }), 2);
  });

  test("data saver is respected even on 4g", () => {
    assert.equal(pickConcurrency({ effectiveType: "4g", saveData: true }), 2);
  });

  // Safari and Firefox have no Network Information API: keep exactly the
  // behaviour the tool had everywhere before this.
  test("no connection API means no change", () => {
    assert.equal(pickConcurrency(null), 2);
    assert.equal(pickConcurrency({}), 2);
  });
});
