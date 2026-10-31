import assert from 'node:assert/strict';
import { test } from 'node:test';
import { add } from './code.mjs';

test('adds positive numbers', () => {
  assert.equal(add(2, 3), 5);
  assert.equal(add(11, 13), 24);
});

test('adds negative numbers', () => {
  assert.equal(add(-7, 2), -5);
  assert.equal(add(2, -7), -5);
  assert.equal(add(-4, -6), -10);
});

test('adds with zero on either side', () => {
  assert.equal(add(0, 0), 0);
  assert.equal(add(5, 0), 5);
  assert.equal(add(0, 5), 5);
  assert.equal(add(-3, 0), -3);
});

test('adds fractional numbers', () => {
  assert.equal(add(0.5, 0.25), 0.75);
  assert.equal(add(-1.5, 0.5), -1);
  assert.equal(add(1.1, 2.2), 1.1 + 2.2);
});

test('regression: add never subtracts', () => {
  assert.notEqual(add(2, 3), 2 - 3);
  assert.equal(add(2, 3), 2 + 3);
});
