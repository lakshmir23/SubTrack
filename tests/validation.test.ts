import assert from 'node:assert/strict';
import test from 'node:test';
import { passwordProblem, signupSchema } from '../shared/validation.js';

test('AUTH-02: password boundary is nine characters, with no invented digit requirement', () => {
  assert.ok(passwordProblem('Abcdefg!'), 'Eight characters must fail.');
  assert.equal(passwordProblem('Abcdefgh!'), null, 'Nine characters without a digit must work.');
  assert.ok(passwordProblem('abcdefgh!'), 'Uppercase is required.');
  assert.ok(passwordProblem('ABCDEFGH!'), 'Lowercase is required.');
  assert.ok(passwordProblem('Abcdefghi'), 'A special character is required.');
  assert.ok(passwordProblem('Abcdefgh '), 'Whitespace is not the required special character.');
  assert.ok(passwordProblem('Abcdefghé'), 'A Unicode letter is not punctuation or a symbol.');
  assert.ok(passwordProblem('AbcdeF!😀'), 'Eight Unicode code points must fail even when UTF-16 length is nine.');
  assert.equal(passwordProblem('Ébcdefgh!'), null, 'Unicode uppercase letters are valid uppercase.');
  assert.equal(passwordProblem('ABCDEFGé!'), null, 'Unicode lowercase letters are valid lowercase.');
  assert.equal(passwordProblem(`Aa!${'😀'.repeat(125)}`), null, 'The maximum is 128 code points, not 128 UTF-16 units.');
  assert.ok(passwordProblem(`Aa!${'😀'.repeat(126)}`));
});

test('AUTH-01/AUTH-05: shared signup validation normalizes email and rejects role injection', () => {
  const accepted = signupSchema.parse({ name: 'New Customer', email: '  CUSTOMER@EXAMPLE.TEST  ', password: 'Abcdefgh!' });
  assert.equal(accepted.email, 'customer@example.test');
  assert.equal(signupSchema.safeParse({ ...accepted, role: 'admin' }).success, false);
  assert.equal(signupSchema.safeParse({ ...accepted, email: 'not-an-address' }).success, false);
  assert.equal(signupSchema.safeParse({ ...accepted, name: ' ' }).success, false);
});
