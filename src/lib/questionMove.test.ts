import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { canMoveInto, nextSortOrder, planMove, type MovableQuestion } from "./questionMove";

const q = (over: Partial<MovableQuestion> = {}): MovableQuestion => ({
  id: "q1",
  type: "qcs",
  parent_id: null,
  sort_order: 10,
  ...over,
});
const kase = (id: string): MovableQuestion => ({
  id,
  type: "cas_clinique",
  parent_id: null,
  sort_order: 10,
});

describe("canMoveInto", () => {
  test("a sub-question can go to another case", () => {
    assert.equal(canMoveInto(q({ parent_id: "caseA" }), kase("caseB")), true);
  });

  test("a standalone question can go into a case", () => {
    assert.equal(canMoveInto(q(), kase("caseA")), true);
  });

  test("a sub-question can leave its case", () => {
    assert.equal(canMoveInto(q({ parent_id: "caseA" }), null), true);
  });

  // Dropping something where it already is must not write anything.
  test("its own case is not a destination", () => {
    assert.equal(canMoveInto(q({ parent_id: "caseA" }), kase("caseA")), false);
  });

  test("a standalone question cannot be taken out of nothing", () => {
    assert.equal(canMoveInto(q(), null), false);
  });

  test("a clinical case is never dragged", () => {
    assert.equal(canMoveInto(kase("caseA"), kase("caseB")), false);
    assert.equal(canMoveInto(kase("caseA"), null), false);
  });

  test("cases do not nest, and nothing drops onto a plain question", () => {
    assert.equal(canMoveInto(q(), q({ id: "other" })), false);
    assert.equal(canMoveInto(q({ id: "self" }), { id: "self", type: "cas_clinique" }), false);
  });
});

describe("nextSortOrder", () => {
  test("lands after the last sibling", () => {
    assert.equal(nextSortOrder([{ sort_order: 10 }, { sort_order: 20 }]), 30);
  });

  test("an empty destination starts the numbering", () => {
    assert.equal(nextSortOrder([]), 10);
  });

  // The table really does hold these — the list keeps reindexIfNeeded for it.
  test("survives nulls, duplicates and orders that run backwards", () => {
    assert.equal(nextSortOrder([{ sort_order: null }, { sort_order: 40 }]), 50);
    assert.equal(nextSortOrder([{ sort_order: 30 }, { sort_order: 30 }]), 40);
    assert.equal(nextSortOrder([{ sort_order: 90 }, { sort_order: 20 }]), 100);
    assert.equal(nextSortOrder([{ sort_order: null }]), 10);
  });
});

describe("planMove", () => {
  test("moving to another case is one update", () => {
    assert.deepEqual(
      planMove(q({ parent_id: "caseA" }), kase("caseB"), [{ sort_order: 10 }, { sort_order: 20 }]),
      { parent_id: "caseB", sort_order: 30 },
    );
  });

  test("an empty case takes the question first", () => {
    assert.deepEqual(planMove(q({ parent_id: "caseA" }), kase("caseB"), []), {
      parent_id: "caseB",
      sort_order: 10,
    });
  });

  test("leaving a case clears the parent and lands after the last question", () => {
    assert.deepEqual(planMove(q({ parent_id: "caseA" }), null, [{ sort_order: 70 }]), {
      parent_id: null,
      sort_order: 80,
    });
  });

  test("a drop that changes nothing writes nothing", () => {
    assert.equal(planMove(q({ parent_id: "caseA" }), kase("caseA"), [{ sort_order: 10 }]), null);
    assert.equal(planMove(kase("caseA"), kase("caseB"), []), null);
    assert.equal(planMove(q(), null, []), null);
  });
});
