import assert from 'node:assert/strict';
import test from 'node:test';
import { add } from './code.mjs';

const cases = [
  [2, 3, 5],
  [11, 13, 24],
  [-7, 2, -5],
  [2, -7, -5],
  [-7, -2, -9],
  [0, 0, 0],
  [0, 9, 9],
  [9, 0, 9],
  [1.25, 2.5, 3.75],
  [-1.25, 0.5, -0.75],
];

for (const [a, b, expected] of cases) {
  test(`add(${a}, ${b}) equals ${expected}`, () => {
    assert.equal(add(a, b), expected);
  });
}
