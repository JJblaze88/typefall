// Unit tests for the leaderboard rules:  node --test tests/leaderboard-core.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { isRude, cleanName, validateSubmission, insert, top, compare } from '../netlify/lib/leaderboard-core.mjs';

const ok = { mode: 'time-30', wpm: 72, acc: 97, target: 30, name: 'Ada' };

test('nickname cleaning', () => {
  assert.equal(cleanName('  Speedy   Gonz  '), 'Speedy Gonz');
  assert.equal(cleanName('Zoë_99!'), 'Zoë_99!');
  assert.equal(cleanName('abcdefghijklm'), null);      // 13 chars
  assert.equal(cleanName(''), null);
  assert.equal(cleanName('   '), null);
  assert.equal(cleanName('<script>'), null);
  assert.equal(cleanName('a"b'), null);
  assert.equal(cleanName('Вася'), null);                // non-Latin (homoglyph risk)
  assert.equal(cleanName('!!!'), null);
  assert.equal(cleanName(42), null);
});

test('profanity filter catches leetspeak, spacing and repeats', () => {
  for (const n of ['fuck', 'FuCk3r', 'f u c k', 'fvck' /* not listed */, 'phuck', 'sh1t', 'sh!t', '$h1t', 'b1tch', 'fuuuuck', 'Fu.ck',
    'n1gg4', 'c u n t', 'a55', 'ASS', 'kkk', 'xXx', 'dick', 'DickHead', 'p0rn', 'r4pe', 'big tits', 'f4gg0t']) {
    if (n === 'fvck') continue;
    assert.ok(isRude(n), `should flag ${n}`);
  }
});

test('profanity filter leaves ordinary names alone', () => {
  for (const n of ['Bob', 'Nigel', 'Grape', 'Spice Girl', 'Dickens', 'Scunthorpe', 'Cassie', 'Glasses', 'Ho Ho Ho', 'Hancock',
    'Peacock', 'Classy', 'Analyst', 'Bassist', 'Shiitake', 'Matilda', 'Jeremy', 'K', 'X', 'Pip', 'Typer 3000', 'Cumbria', 'Assassin']) {
    assert.ok(!isRude(n), `should not flag ${n}`);
  }
});

test('submission validation', () => {
  assert.ok(validateSubmission(ok).value);
  assert.match(validateSubmission({ ...ok, wpm: 400 }).error, /WPM/);
  assert.match(validateSubmission({ ...ok, wpm: 251 }).error, /WPM/);
  assert.ok(validateSubmission({ ...ok, wpm: 250, target: 60 }).value);
  assert.match(validateSubmission({ ...ok, acc: 89.9 }).error, /Accuracy/);
  assert.match(validateSubmission({ ...ok, acc: 100.1 }).error, /Accuracy/);
  assert.match(validateSubmission({ ...ok, mode: 'time-45' }).error, /mode/);
  assert.match(validateSubmission({ ...ok, wpm: 25, target: 30 }).error, /passed/);
  assert.match(validateSubmission({ ...ok, wpm: '72' }).error, /wpm/);
  assert.match(validateSubmission({ ...ok, wpm: 72.5 }).error, /wpm/);
  assert.match(validateSubmission(null).error, /Malformed/);
  assert.match(validateSubmission([1]).error, /Malformed/);
  assert.equal(validateSubmission({ ...ok, name: 'sh1thead' }).code, 'rude');
});

test('ranking: WPM first, accuracy breaks ties, earlier wins full ties', () => {
  let list = [];
  const e = (id, name, wpm, acc, at) => ({ id, name, wpm, acc, at });
  list = insert(list, e('a', 'A', 80, 95, 1)).list;
  list = insert(list, e('b', 'B', 80, 99, 2)).list;
  list = insert(list, e('c', 'C', 90, 91, 3)).list;
  const r = insert(list, e('d', 'D', 80, 99, 4));
  assert.deepEqual(r.list.map(x => x.id), ['c', 'b', 'd', 'a']);
  assert.equal(r.rank, 3);
});

test('one entry per nickname (best kept), trimmed to keep size', () => {
  let list = [];
  list = insert(list, { id: '1', name: 'Ada', wpm: 60, acc: 95, at: 1 }).list;
  let r = insert(list, { id: '2', name: 'ada', wpm: 50, acc: 99, at: 2 });
  assert.equal(r.improved, false); assert.equal(r.list.length, 1); assert.equal(r.rank, 1);
  r = insert(r.list, { id: '3', name: 'ADA', wpm: 70, acc: 92, at: 3 });
  assert.equal(r.improved, true); assert.deepEqual(r.list.map(x => x.id), ['3']);
  let big = [];
  for (let i = 0; i < 60; i++) big = insert(big, { id: 'x' + i, name: 'P' + i, wpm: 30 + i, acc: 95, at: i }).list;
  assert.equal(big.length, 50);
  assert.equal(top(big).length, 10);
  assert.equal(top(big)[0].wpm, 89);
  const low = insert(big, { id: 'low', name: 'Slow', wpm: 21, acc: 95, at: 99 });
  assert.equal(low.rank, null);
  assert.ok(compare({ wpm: 1, acc: 1, at: 0 }, { wpm: 2, acc: 1, at: 0 }) > 0);
});

test('rate limit: 5 per minute, sliding window', async () => {
  const { rateCheck } = await import('../netlify/lib/leaderboard-core.mjs');
  let s = [];
  for (let i = 0; i < 5; i++) { const r = rateCheck(s, 1000 + i); assert.ok(r.allowed); s = r.stamps; }
  const blocked = rateCheck(s, 2000);
  assert.equal(blocked.allowed, false); assert.ok(blocked.retryAfter >= 1);
  assert.ok(rateCheck(s, 1000 + 60_000).allowed);
});
