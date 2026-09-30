import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  canMoveHere,
  canMoveInto,
  lessonOf,
  moveTargets,
  nextSortOrder,
  planMove,
  type MovableQuestion,
} from "./questionMove";

const q = (over: Partial<MovableQuestion> = {}): MovableQuestion => ({
  id: "q1",
  type: "qcs",
  parent_id: null,
  folder_id: null,
  sort_order: 10,
  ...over,
});
const kase = (id: string, folder_id: string | null = null): MovableQuestion => ({
  id,
  type: "cas_clinique",
  parent_id: null,
  folder_id,
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

/**
 * The move menu used to list every clinical case in the module — past
 * twenty-seven of them on one real module, each a truncated énoncé in a
 * scrolling dropdown. The case wanted is all but always in the lesson already
 * on screen.
 */
describe("which cases a question may be moved into", () => {
  const BPCO = kase("bpco1", "bpco");
  const BPCO2 = kase("bpco2", "bpco");
  const ASTHME = kase("asthme1", "asthme");
  const UNFILED = kase("nofolder", null);
  const all = [BPCO, BPCO2, ASTHME, UNFILED];

  test("only its own lesson's cases are offered", () => {
    const targets = moveTargets(q({ folder_id: "bpco" }), all);
    assert.deepEqual(
      targets.map((c) => c.id),
      ["bpco1", "bpco2"],
    );
  });

  // A sub-question that was never filed takes the lesson of the case it is in,
  // so it is offered that lesson's other cases rather than the whole module.
  test("a sub-question with no lesson of its own inherits its case's", () => {
    const sub = q({ parent_id: "bpco1", folder_id: null });
    assert.equal(lessonOf(sub, all), "bpco");
    assert.deepEqual(
      moveTargets(sub, all).map((c) => c.id),
      ["bpco2"],
      "and not the case it is already in",
    );
  });

  // "Sans cours" is a group like any other, not a wildcard.
  test("a question with no lesson anywhere sees only the unfiled cases", () => {
    assert.equal(lessonOf(q(), all), null);
    assert.deepEqual(
      moveTargets(q(), all).map((c) => c.id),
      ["nofolder"],
    );
  });

  test("its own lesson wins over the case it happens to sit in", () => {
    const drifted = q({ parent_id: "bpco1", folder_id: "asthme" });
    assert.equal(lessonOf(drifted, all), "asthme");
    assert.deepEqual(
      moveTargets(drifted, all).map((c) => c.id),
      ["asthme1"],
    );
  });

  // The narrowing must not quietly undo the rules it narrows.
  test("canMoveInto still decides the rest", () => {
    assert.deepEqual(
      moveTargets(q({ parent_id: "bpco1", folder_id: "bpco" }), all).map((c) => c.id),
      ["bpco2"],
      "never the case it is already in",
    );
    assert.deepEqual(moveTargets(kase("bpco1", "bpco"), all), [], "a case is never moved");
  });

  test("a lesson with no other case offers nothing, rather than everything", () => {
    assert.deepEqual(moveTargets(q({ folder_id: "asthme", parent_id: "asthme1" }), all), []);
    assert.deepEqual(moveTargets(q({ folder_id: "inconnu" }), all), []);
  });

  test("no cases at all is not a crash", () => {
    assert.deepEqual(moveTargets(q({ folder_id: "bpco" }), []), []);
    assert.equal(lessonOf(q({ parent_id: "gone" }), []), null);
  });

  // A drag and the menu ask the same question, so they cannot disagree about
  // where a question may land.
  test("one destination answers the same as the list", () => {
    const sub = q({ parent_id: "bpco1", folder_id: "bpco" });
    assert.equal(canMoveHere(sub, BPCO2, all), true);
    assert.equal(canMoveHere(sub, ASTHME, all), false, "another lesson's case is not a target");
    assert.equal(canMoveHere(sub, BPCO, all), false, "nor the case it is already in");
    for (const c of all) {
      assert.equal(
        canMoveHere(sub, c, all),
        moveTargets(sub, all).some((t) => t.id === c.id),
      );
    }
  });

  // "Hors cas clinique": a question can always be taken out of its case,
  // whatever lesson either of them is filed under.
  test("leaving every case is never narrowed", () => {
    assert.equal(canMoveHere(q({ parent_id: "asthme1", folder_id: "bpco" }), null, all), true);
    assert.equal(canMoveHere(q({ parent_id: null }), null, all), false, "it is already out");
  });
});
