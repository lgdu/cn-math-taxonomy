(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  let model, session, diagnosis, hero;
  let playing = false, lastFrame = null, accumulated = 0, frameId = 0;
  let feedback = '', feedbackCorrect = false, hintText = '';
  const names = ['先做了多少', '还剩多少', '合作有多快', '合作需要几天', '一共用了几天'];

  function text(id, value) { $(id).textContent = value; }
  function format(value) { return value.toString(); }
  function timeText(value) {
    if (value.d === 1n) return String(value.n);
    const whole = value.n / value.d, rest = value.n % value.d;
    return (whole ? whole + '又' : '') + rest + '/' + value.d;
  }
  function stop() {
    playing = false; lastFrame = null; accumulated = 0;
    cancelAnimationFrame(frameId); frameId = 0;
    text('play', '▶ 播放'); $('play').setAttribute('aria-label', '播放动画');
  }
  function renderVisual() {
    const v = model.at(session.tick), route = session.route;
    const unit = route === 'unit_one' ? '项' : '份';
    text('total-label', format(model.scale(model.total, route)) + unit);
    text('a-rate', format(model.scale(model.aRate, route)) + unit);
    text('b-rate', format(model.scale(model.bRate, route)) + unit);
    text('day-label', '已经过' + timeText(v.day) + '天');
    text('a-done', format(model.scale(v.a, route)) + unit);
    text('b-done', format(model.scale(v.b, route)) + unit);
    text('remaining', format(model.scale(v.remaining, route)) + unit);
    for (const [id, val] of [['a-segment', v.a], ['b-segment', v.b], ['remaining-segment', v.remaining]]) {
      $(id).style.width = (val.div(model.total).number() * 100) + '%';
    }
    $('work-track').setAttribute('aria-label', '甲完成' + $('a-done').textContent + '，乙完成' + $('b-done').textContent + '，剩余' + $('remaining').textContent);
    const unlocked = session.finished || session.mode === 'explain';
    const fraction = route === 'unit_one';
    text('phase-note', session.tick < model.soloTicks
      ? '这一段只有甲工作。乙还没有加入，完成量保持为0。'
      : session.tick === model.finishTicks
        ? '任务刚好完成。两人的贡献加起来等于总任务，时间也要算上最初独做的一段。'
        : '从这里开始，两人一起工作。相加的是同一天各自完成的工作量。');
    text('joint-period', unlocked ? '合作' + format(model.jointDays) + '天' : '时长待求');
    text('unlock-note', unlocked
      ? '拖动时间条，或点击播放，观察每一段的完成量。切换计量方式不会改变时间。'
      : '先完成5步推理，再看完整的合作过程。也可以直接观看讲解。');
    $('seek').max = String(session.maxTick()); $('seek').value = String(session.tick);
    $('seek').setAttribute('aria-valuetext', '经过' + timeText(v.day) + '天');
    $('work-track').classList.toggle('fraction-route', fraction);
  }
  function renderSolution() {
    const unit = session.route === 'unit_one' ? '项' : '份';
    const work = x => format(model.scale(x, session.route));
    const lines = [
      '先独做：' + work(model.aRate) + ' × ' + format(model.soloDays) + ' = ' + work(model.first) + unit + '。',
      '剩余：' + work(model.total) + ' − ' + work(model.first) + ' = ' + work(model.remaining) + unit + '。',
      '合作效率：' + work(model.aRate) + ' + ' + work(model.bRate) + ' = ' + work(model.jointRate) + unit + '/天。',
      '合作时长：' + work(model.remaining) + ' ÷ (' + work(model.jointRate) + ') = ' + format(model.jointDays) + '天。',
      '总时长：' + format(model.soloDays) + ' + ' + format(model.jointDays) + ' = ' + format(model.finishDays) + '天。'
    ];
    $('solution').replaceChildren(...lines.map(line => { const li = document.createElement('li'); li.textContent = line; return li; }));
  }
  function renderExercise() {
    const explain = session.mode === 'explain', summary = explain || session.finished;
    $('practice-panel').hidden = summary; $('summary-panel').hidden = !summary;
    $('explain').hidden = summary;
    text('progress-label', explain ? '跟着讲解，看清关系' : session.finished ? '5步推理 · 本次记录' : '第' + (session.step + 1) + '步 / 共5步');
    $('stepper').replaceChildren(...names.map((name, i) => {
      const li = document.createElement('li');
      if (session.records.some(r => r.step === i)) li.className = 'complete';
      else if (i === session.step && !summary) li.className = 'current';
      li.setAttribute('aria-label', '第' + (i + 1) + '步：' + name + (li.className === 'complete' ? '，已完成' : li.className === 'current' ? '，当前步骤' : ''));
      return li;
    }));
    if (summary) {
      text('summary-title', explain ? '把五步连成一条线' : '这次推理，走通了');
      const own = session.records.filter(r => r.state === 'correct_unassisted').length;
      text('summary-copy', explain
        ? '先看完整解法，再点击播放。想自己试一次，可以点“重新开始”。'
        : '本次有' + own + '步无提示答对，其余' + (5 - own) + '步使用了提示或查看答案。这是作答记录，不是能力等级。');
      text('summary-note', '下一步可尝试“已知合作时间，反求另一人的效率”，再比较轮流工作为什么不能直接套用合作公式。');
      renderSolution(); return;
    }
    const checkpoint = diagnosis.checkpoints[session.step];
    text('exercise-heading', names[session.step]); text('step-prompt', checkpoint.prompt);
    text('answer-unit', checkpoint.unit[session.route]);
    $('answer').disabled = session.solved; $('submit').hidden = session.solved;
    $('answer').setAttribute('aria-invalid', String(Boolean(feedback && !feedbackCorrect && !session.solved)));
    $('next').hidden = !session.solved;
    text('next', session.step === 4 ? '查看解法与完整动画 →' : '下一步 →');
    $('hint').disabled = session.solved; $('reveal-step').disabled = session.solved;
    if (session.solved) $('answer').value = format(model.expected(session.step, session.route));
    $('feedback').hidden = !feedback; text('feedback', feedback);
    $('feedback').classList.toggle('correct', feedbackCorrect);
    $('hint-box').hidden = !hintText; text('hint-box', hintText);
  }
  function render() { renderVisual(); renderExercise(); }
  function clearMessages() { feedback = ''; feedbackCorrect = false; hintText = ''; $('answer').value = ''; }

  function animate(now) {
    if (playing) {
      if (lastFrame !== null) accumulated += Math.min(100, now - lastFrame) * Number($('speed').value);
      lastFrame = now;
      // 12 ticks = one day. One day takes 2.4 screen seconds at 1×.
      const steps = Math.floor(accumulated / 200);
      if (steps) {
        accumulated -= steps * 200; session.seek(session.tick + steps); renderVisual();
        if (session.tick >= session.maxTick()) stop();
      }
    }
    if (playing) frameId = requestAnimationFrame(animate);
  }
  function bind() {
    $('answer-form').addEventListener('submit', event => {
      event.preventDefault();
      const result = session.submit($('answer').value);
      if (result.ignored) return;
      if (result.formatError) { feedback = result.formatError; feedbackCorrect = false; renderExercise(); return; }
      if (result.correct) {
        feedback = result.assisted ? '这一步在提示后完成了。接着看下一步。' : '这一步对了。接着看下一步。';
        feedbackCorrect = true; stop();
      } else {
        feedback = diagnosis.checkpoints[session.step].wrong_response;
        feedbackCorrect = false;
        session.hint();
      }
      render();
    });
    $('hint').addEventListener('click', () => {
      session.hint();
      const c = diagnosis.checkpoints[session.step];
      hintText = c.wrong_response + ' 先用总量36份来检查：' + c.next_probe;
      renderExercise();
    });
    $('reveal-step').addEventListener('click', () => {
      session.revealStep();
      feedback = '本步答案是' + format(model.expected(session.step, session.route)) + diagnosis.checkpoints[session.step].unit[session.route] + '。已记录为查看答案，可以继续。';
      feedbackCorrect = false; renderExercise();
    });
    $('next').addEventListener('click', () => {
      if (!session.next()) return;
      clearMessages(); render();
      (session.finished ? $('summary-title') : $('exercise-heading')).focus();
    });
    document.querySelectorAll('input[name="route"]').forEach(input => input.addEventListener('change', () => {
      session.setRoute(input.value);
      clearMessages();
      // Same step and hint history are kept; route switching never certifies mastery.
      if (session.solved) { feedback = '本步已经完成，当前显示等价计量方式。'; feedbackCorrect = true; }
      render();
    }));
    $('explain').addEventListener('click', () => {
      stop(); session.revealLesson(); session.seek(0); render(); $('summary-title').focus();
    });
    $('reset').addEventListener('click', () => {
      stop(); session.reset(); clearMessages();
      document.querySelector('input[name="route"][value="integer_total"]').checked = true;
      render(); $('exercise-heading').focus();
    });
    $('play').addEventListener('click', () => {
      if (playing) { stop(); return; }
      if (session.tick >= session.maxTick()) session.seek(0);
      playing = true; lastFrame = null; accumulated = 0;
      text('play', 'Ⅱ 暂停'); $('play').setAttribute('aria-label', '暂停动画');
      renderVisual();
      frameId = requestAnimationFrame(animate);
    });
    $('seek').addEventListener('input', () => { stop(); session.seek(Number($('seek').value)); renderVisual(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
  }

  async function init() {
    $('retry').addEventListener('click', () => window.location.reload());
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const base = '../../docs/olympiad/engineering-v0.1/';
      const [lesson, d, questions] = await Promise.all(['lesson-storyboard.json', 'diagnosis-spec.json', 'original-questions.json'].map(async path => {
        const response = await fetch(base + path, { signal: controller.signal });
        if (!response.ok) throw new Error('课程文件暂不可用（' + response.status + '）。');
        return response.json();
      }));
      const data = window.EngineeringLesson.validateData(lesson, d, questions);
      model = data.model; hero = data.hero; diagnosis = d;
      session = new window.EngineeringLesson.Session(model);
      text('problem-prompt', hero.prompt);
      document.querySelector('.route-switch label:first-of-type span').textContent = '分成' + format(model.total) + '份';
      document.querySelector('.timeline-solo b').textContent = '前' + format(model.soloDays) + '天';
      bind(); render(); $('loading').hidden = true; $('lesson').hidden = false;
    } catch (error) {
      $('loading').hidden = true; $('load-error').hidden = false;
      text('load-error-text', window.location.protocol === 'file:'
        ? '浏览器不能直接从本地文件读取课程数据，请通过本地服务打开。'
        : error.name === 'AbortError' ? '课程加载超时，请重试。' : '课程数据读取失败：' + error.message);
    } finally { clearTimeout(timeout); }
  }
  init();
})();
