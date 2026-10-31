import assert from 'node:assert/strict';
import test from 'node:test';
import { add } from './code.mjs';

test('adds positive numbers', () => {
  assert.equal(add(2, 3), 5);
  assert.equal(add(11, 13), 24);
});

test('adds a negative number', () => {
  assert.equal(add(-7, 2), -5);
  assert.equal(add(4, -10), -6);
});

test('adds two negative numbers', () => {
  assert.equal(add(-3, -4), -7);
});

test('handles zero', () => {
  assert.equal(add(0, 0), 0);
  assert.equal(add(0, 5), 5);
  assert.equal(add(-5, 0), -5);
});

test('adds fractions', () => {
  assert.equal(add(0.1, 0.2), 0.30000000000000004);
  assert.equal(add(1.5, 2.25), 3.75);
  assert.equal(add(-0.5, 0.25), -0.25);
});
