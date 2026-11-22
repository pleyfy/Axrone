import assert from "node:assert/strict";
import test from "node:test";
import { median } from "../bench/lib/median.mjs";

test("median filters non-finite values instead of poisoning the result", () => {
    assert.equal(median([1, NaN, 3, Infinity, 5]), 3);
});

test("median of an empty sample list is null, never NaN", () => {
    assert.equal(median([]), null);
});

test("median handles odd and even lengths", () => {
    assert.equal(median([7, 1, 3]), 3);
    assert.equal(median([4, 1, 2, 3]), 2.5);
});

test("median does not mutate its input", () => {
    const values = [5, 1, 3];
    median(values);
    assert.deepEqual(values, [5, 1, 3]);
});
