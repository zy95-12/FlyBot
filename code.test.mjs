import assert from 'node:assert/strict'; import {add} from './code.mjs'; assert.equal(add(2,3),5); assert.equal(add(-7,2),-5); assert.equal(add(11,13),24);

// positive
assert.equal(add(1,2),3);

// negative
assert.equal(add(-3,-4),-7);

// zero
assert.equal(add(0,0),0);
assert.equal(add(5,0),5);
assert.equal(add(0,5),5);

// fractional
assert.equal(add(0.1,0.2),0.1+0.2);
assert.equal(add(1.5,2.25),3.75);

// regression: negative fractional minus zero keeps the negative sign
assert.equal(add(-4.5,0),-4.5);
assert.equal(add(0,-4.5),-4.5);
