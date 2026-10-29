(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EngineeringLesson = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function gcd(a, b) { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b) [a, b] = [b, a % b]; return a; }
  class Rational {
    constructor(n, d = 1n) {
      n = BigInt(n); d = BigInt(d);
      if (d === 0n) throw new Error('分母不能是0。');
      if (d < 0n) { n = -n; d = -d; }
      const g = gcd(n, d); this.n = n / g; this.d = d / g;
    }
    static parse(value) {
      if (value instanceof Rational) return value;
      const s = String(value).trim().replaceAll('／', '/').replaceAll('－', '-');
      if (s.length > 40) throw new Error('请输入一个整数、小数或分数，例如6、0.5、1/6。');
      let m = s.match(/^([+-]?\d{1,12})\s*\/\s*([+-]?\d{1,12})$/);
      if (m) return new Rational(m[1], m[2]);
      m = s.match(/^([+-]?)(\d{1,12})(?:\.(\d{1,12}))?$/);
      if (!m) throw new Error('请输入一个整数、小数或分数，不需要写单位或算式。');
      const d = 10n ** BigInt((m[3] || '').length);
      return new Rational(BigInt(m[2] + (m[3] || '')) * (m[1] === '-' ? -1n : 1n), d);
    }
    add(x) { x = Rational.parse(x); return new Rational(this.n * x.d + x.n * this.d, this.d * x.d); }
    sub(x) { x = Rational.parse(x); return new Rational(this.n * x.d - x.n * this.d, this.d * x.d); }
    mul(x) { x = Rational.parse(x); return new Rational(this.n * x.n, this.d * x.d); }
    div(x) { x = Rational.parse(x); return new Rational(this.n * x.d, this.d * x.n); }
    equals(x) { x = Rational.parse(x); return this.n === x.n && this.d === x.d; }
    number() { return Number(this.n) / Number(this.d); }
    toString() { return this.d === 1n ? String(this.n) : this.n + '/' + this.d; }
    toJSON() { return this.toString(); }
  }

  function createModel(contract) {
    const total = Rational.parse(contract.total), aRate = Rational.parse(contract.A_rate);
    const bRate = Rational.parse(contract.B_rate), soloDays = Rational.parse(contract.solo_days);
    if ([total, aRate, bRate, soloDays].some(v => v.number() <= 0)) throw new Error('任务量、工效和独做时间必须大于0。');
    const first = aRate.mul(soloDays), remaining = total.sub(first), jointRate = aRate.add(bRate);
    if (remaining.number() <= 0) throw new Error('本样例要求合作开始时仍有剩余任务。');
    const jointDays = remaining.div(jointRate), finishDays = soloDays.add(jointDays);
    // Playback uses 12 ticks per mathematical day, unrelated to screen seconds.
    const finishTicks = finishDays.mul(12).number(), soloTicks = soloDays.mul(12).number();
    if (!Number.isSafeInteger(finishTicks) || !Number.isSafeInteger(soloTicks)) throw new Error('本播放器的时间步长不适用于该数据。');
    function at(tick) {
      if (!Number.isFinite(tick)) throw new Error('无效时间。');
      tick = Math.max(0, Math.min(finishTicks, Math.round(tick)));
      const day = new Rational(tick, 12n);
      const a = aRate.mul(day), b = bRate.mul(day.number() > soloDays.number() ? day.sub(soloDays) : 0);
      return { tick, day, a, b, remaining: total.sub(a).sub(b) };
    }
    function scale(value, route) { return route === 'unit_one' ? value.div(total) : value; }
    function expected(step, route) {
      const work = [first, remaining, jointRate];
      if (step < 3) return scale(work[step], route);
      return step === 3 ? jointDays : finishDays;
    }
    return { total, aRate, bRate, soloDays, first, remaining, jointRate, jointDays, finishDays, finishTicks, soloTicks, at, scale, expected };
  }

  class Session {
    constructor(model) { this.model = model; this.reset(); }
    reset() {
      this.route = 'integer_total'; this.step = 0; this.tick = 0; this.mode = 'practice';
      this.records = []; this.assisted = false; this.solved = false; this.finished = false; this.history = [];
    }
    setRoute(route) {
      if (!['integer_total', 'unit_one'].includes(route)) throw new Error('未知路线。');
      this.route = route;
    }
    maxTick() { return this.mode === 'explain' || this.finished ? this.model.finishTicks : this.model.soloTicks; }
    seek(tick) {
      if (!Number.isFinite(tick)) return;
      this.tick = Math.min(this.maxTick(), Math.max(0, Math.round(tick)));
    }
    revealLesson() { this.mode = 'explain'; this.assisted = true; this.history.push({ kind: 'explanation_viewed', atStep: this.step }); }
    hint() { this.assisted = true; this.history.push({ kind: 'hint', step: this.step }); }
    submit(input) {
      if (this.finished || this.solved || this.mode !== 'practice') return { ignored: true };
      let value;
      try { value = Rational.parse(input); } catch (error) { return { formatError: error.message }; }
      const correct = value.equals(this.model.expected(this.step, this.route));
      const record = { step: this.step, route: this.route, answer: value.toString(), correct, assisted: this.assisted };
      this.history.push(record);
      if (correct) {
        this.solved = true;
        this.records.push({ step: this.step, route: this.route, state: this.assisted ? 'scaffolded_correct' : 'correct_unassisted' });
        this.seek(this.model.soloTicks);
      }
      return { correct, assisted: this.assisted };
    }
    revealStep() {
      if (this.solved || this.finished || this.mode !== 'practice') return;
      this.assisted = true; this.solved = true;
      this.records.push({ step: this.step, route: this.route, state: 'answer_viewed' });
      this.history.push({ kind: 'answer_viewed', step: this.step });
    }
    next() {
      if (!this.solved || this.mode !== 'practice') return false;
      if (this.step === 4) { this.finished = true; return true; }
      this.step++; this.solved = false; this.assisted = false;
      return true;
    }
  }

  function validateData(lesson, diagnosis, questions) {
    const hero = questions.questions.find(q => q.id === lesson.question_id);
    if (!hero || diagnosis.question_id !== hero.id || diagnosis.checkpoints.length !== 5) throw new Error('课程数据不匹配。');
    const model = createModel(lesson.mathematical_contract);
    if (!model.finishDays.equals(hero.answer)) throw new Error('题目答案与动画模型不一致。');
    diagnosis.checkpoints.forEach((c, step) => {
      for (const route of ['integer_total', 'unit_one']) {
        if (!model.expected(step, route).equals(c.expected[route])) throw new Error('检查点答案与模型不一致。');
      }
    });
    return { model, hero };
  }
  return { Rational, createModel, Session, validateData };
});
