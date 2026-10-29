const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Rational: R, createModel, Session, validateData } = require('./lesson.js');
const dataDir = path.resolve(__dirname, '../../docs/olympiad/engineering-v0.1');
const read = name => JSON.parse(fs.readFileSync(path.join(dataDir, name), 'utf8'));
const lesson = read('lesson-storyboard.json'), diagnosis = read('diagnosis-spec.json');
const questions = read('original-questions.json');
const { model } = validateData(lesson, diagnosis, questions);

test('equivalent fractions, finite decimals and full-width fraction slash', () => {
  assert.ok(R.parse('2/12').equals('1/6'));
  assert.ok(R.parse('0.500').equals('1/2'));
  assert.ok(R.parse(' 10 ／ 72 ').equals('5/36'));
  assert.ok(R.parse('－2/－12').equals('1/6'));
  assert.equal(R.parse('-0.0').toString(), '0');
});

test('invalid formats and executable input are rejected without eval', () => {
  for (const s of ['', '1/0', '1/2/3', '1+2', '1e2', 'Infinity', 'NaN', 'globalThis.x=1', '8天', '1234567890123', '1'.repeat(41)]) {
    assert.throws(() => R.parse(s), undefined, s);
  }
});

test('the timeline obeys conservation at every tick and starts B at day 2', () => {
  for (let i = 0; i <= 96; i++) {
    const s = model.at(i);
    assert.ok(s.a.add(s.b).add(s.remaining).equals(36));
    assert.ok(s.remaining.number() >= 0);
    assert.ok(model.scale(s.a, 'unit_one').add(model.scale(s.b, 'unit_one')).add(model.scale(s.remaining, 'unit_one')).equals(1));
    if (i <= 24) assert.ok(s.b.equals(0));
  }
  assert.equal(model.at(24).remaining.toString(), '30');
  assert.equal(model.at(96).a.toString(), '24');
  assert.equal(model.at(96).b.toString(), '12');
  assert.equal(model.at(10000).remaining.toString(), '0');
  assert.equal(model.at(-10).day.toString(), '0');
  assert.throws(() => model.at(Infinity));
});

test('the model derives results rather than assuming 12, 18 and 2', () => {
  const alternate = createModel({ total: 60, A_rate: 5, B_rate: 3, solo_days: 4 });
  assert.equal(alternate.remaining.toString(), '40');
  assert.equal(alternate.jointDays.toString(), '5');
  assert.equal(alternate.finishDays.toString(), '9');
  assert.throws(() => createModel({ total: 10, A_rate: 5, B_rate: 3, solo_days: 4 }));
});

test('course ID, model and diagnostic mismatches fail before presentation', () => {
  assert.throws(() => validateData({ ...lesson, question_id: 'missing' }, diagnosis, questions));
  const broken = structuredClone(diagnosis); broken.checkpoints[3].expected.unit_one = '7';
  assert.throws(() => validateData(lesson, broken, questions));
  const brokenQuestions = structuredClone(questions);
  brokenQuestions.questions.find(q => q.id === lesson.question_id).answer = 7;
  assert.throws(() => validateData(lesson, diagnosis, brokenQuestions));
});

test('practice gates the timeline; answering steps does not leak the total time', () => {
  const s = new Session(model);
  assert.equal(s.next(), false);
  s.seek(96); assert.equal(s.tick, 24);
  for (const answer of ['6', '30', '5', '6']) {
    assert.equal(s.submit(answer).correct, true);
    assert.equal(s.maxTick(), 24);
    assert.equal(s.next(), true);
  }
  assert.equal(s.step, 4);
  assert.equal(s.submit('6').correct, false); // Cooperation time is not total time.
  assert.equal(s.finished, false);
  assert.equal(s.submit('8').correct, true);
  s.next(); assert.equal(s.finished, true); assert.equal(s.maxTick(), 96);
  assert.equal(s.records.length, 5);
  assert.equal(s.submit('8').ignored, true);
});

test('fraction route accepts equivalent answers through the whole lesson', () => {
  const s = new Session(model); s.setRoute('unit_one');
  for (const answer of ['2/12', '30/36', '10/72', '6.0', '8']) {
    assert.equal(s.submit(answer).correct, true); s.next();
  }
  assert.equal(s.finished, true);
  assert.equal(s.records.every(r => r.state === 'correct_unassisted'), true);
});

test('a route switch preserves the step and hint evidence; invalid input is not a math failure', () => {
  const s = new Session(model);
  assert.ok(s.submit('1/0').formatError);
  assert.equal(s.history.length, 0);
  s.hint(); s.setRoute('unit_one');
  assert.equal(s.step, 0);
  assert.equal(s.submit('1/6').correct, true);
  assert.equal(s.records[0].state, 'scaffolded_correct');
  s.setRoute('integer_total');
  assert.equal(s.records.length, 1);
  assert.equal(s.submit('6').ignored, true);
  s.next(); assert.equal(s.assisted, false);
});

test('viewing an answer and watching the solution are not recorded as unassisted success', () => {
  const s = new Session(model);
  s.revealStep(); assert.equal(s.records[0].state, 'answer_viewed');
  s.next(); s.revealLesson(); assert.equal(s.maxTick(), 96);
  assert.equal(s.submit('30').ignored, true);
  assert.equal(s.finished, false);
  s.reset(); assert.equal(s.mode, 'practice'); assert.equal(s.maxTick(), 24);
  assert.equal(s.records.length, 0); assert.equal(s.history.length, 0);
});

test('DOM references exist and are unique; player has no textbook or remote dependency', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  assert.equal(ids.length, new Set(ids).size);
  const lookups = [...app.matchAll(/(?:\$|text)\('([^']+)'/g)].map(m => m[1]);
  for (const id of lookups) assert.ok(ids.includes(id), 'Missing DOM ID: ' + id);
  assert.doesNotMatch(html, /(?:src|href)="https?:/);
  assert.doesNotMatch(app, /localStorage|sessionStorage|sendBeacon|XMLHttpRequest/);
  assert.doesNotMatch(app + html, /libfile_|\.pdf["']/i);
});
