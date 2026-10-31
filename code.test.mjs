import assert from 'node:assert/strict';
import test from 'node:test';
import { add } from './code.mjs';

test('adds positive numbers', () => {
  assert.equal(add(2, 3), 5);
  assert.equal(add(11, 13), 24);
});

test('adds negative numbers and mixed signs', () => {
  assert.equal(add(-7, 2), -5);
  assert.equal(add(-3, -4), -7);
  assert.equal(add(7, -2), 5);
});

test('adds zero', () => {
  assert.equal(add(0, 0), 0);
  assert.equal(add(5, 0), 5);
  assert.equal(add(0, 5), 5);
});

test('adds fractional numbers', () => {
  assert.equal(add(1.25, 2.5), 3.75);
  assert.equal(add(-1.5, 0.25), -1.25);
});

test('preserves a negative fraction when adding zero', () => {
  assert.equal(add(-4.5, 0), -4.5);
});
