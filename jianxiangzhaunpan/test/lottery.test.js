import assert from "node:assert/strict";
import test from "node:test";

import {
  generateCode,
  normalizePrizeInput,
  pickPrize,
  visiblePrizes
} from "../src/lottery.js";

test("generateCode returns readable unique-looking uppercase codes", () => {
  const first = generateCode();
  const second = generateCode();

  assert.match(first, /^[A-Z0-9]{8}$/);
  assert.match(second, /^[A-Z0-9]{8}$/);
  assert.notEqual(first, second);
});

test("normalizePrizeInput rejects missing drawable probability", () => {
  assert.throws(
    () => normalizePrizeInput([{ name: "Gold", probability: 0, stock: 1 }]),
    /At least one prize/
  );
});

test("visiblePrizes hides inactive and exhausted prizes", () => {
  const prizes = visiblePrizes([
    { id: 1, name: "Gold", probability: 10, stock: 1, won_count: 0 },
    { id: 2, name: "Silver", probability: 20, stock: 1, won_count: 1 },
    { id: 3, name: "Bronze", probability: 30, stock: null, won_count: 9 },
    { id: 4, name: "Zero", probability: 0, stock: null, won_count: 0 }
  ]);

  assert.deepEqual(
    prizes.map((prize) => prize.name),
    ["Gold", "Bronze"]
  );
});

test("pickPrize uses probability weights after stock filtering", () => {
  const prizes = [
    { id: 1, name: "Rare", probability: 1, stock: 1, won_count: 1 },
    { id: 2, name: "Common", probability: 99, stock: null, won_count: 0 }
  ];

  const selected = pickPrize(prizes, () => 0);

  assert.equal(selected.name, "Common");
});

test("pickPrize selects weighted prize by random value", () => {
  const prizes = [
    { id: 1, name: "A", probability: 25, stock: null, won_count: 0 },
    { id: 2, name: "B", probability: 75, stock: null, won_count: 0 }
  ];

  assert.equal(pickPrize(prizes, () => 0.1).name, "A");
  assert.equal(pickPrize(prizes, () => 0.5).name, "B");
});
