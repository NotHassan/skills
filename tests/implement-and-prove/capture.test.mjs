import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyCapture } from '../../plugins/implement-and-prove/skills/implement-and-prove/scripts/lib/record.mjs';
const base = { phase: 'before', type: 'bugfix', comparison: 'same-scenario', criteria: ['bug', 'persists'], expectedBeforeFailures: ['bug'], checks: [{ id: 'bug', status: 'failed' }, { id: 'persists', status: 'passed' }], error: null };
test('exact expected assertion failure reproduces bug', () => assert.equal(classifyCapture(base), 'reproduced'));
test('server/locator failures are blockers', () => assert.equal(classifyCapture({ ...base, error: 'connection refused' }), 'blocked'));
test('unrelated failing assertion is not this reproduction', () => assert.equal(classifyCapture({ ...base, checks: [{ id: 'bug', status: 'passed' }, { id: 'persists', status: 'failed' }] }), 'unexpected-failure'));
test('all passing before means not reproduced', () => assert.equal(classifyCapture({ ...base, checks: base.checks.map(c => ({ ...c, status: 'passed' })) }), 'not-reproduced'));
test('missing criterion is blocked', () => assert.equal(classifyCapture({ ...base, checks: [] }), 'blocked'));
test('after must satisfy every criterion', () => assert.equal(classifyCapture({ ...base, phase: 'after' }), 'failed'));
test('unexpected after runtime errors fail acceptance capture', () => assert.equal(classifyCapture({ ...base, phase: 'after', checks: base.checks.map(c => ({ ...c, status: 'passed' })), runtimeErrors: [{}] }), 'failed'));
test('feature baseline is not labeled a passed acceptance test', () => assert.equal(classifyCapture({ ...base, type: 'feature', comparison: 'baseline-plus-new', checks: [] }), 'baseline-captured'));

test('unrelated before runtime errors do not prove the reported bug', () => assert.equal(classifyCapture({ ...base, runtimeErrors: [{kind: 'http', message: '503 unrelated'}] }), 'unexpected-failure'));
