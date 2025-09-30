// frontend/js/pages/announcements/components/timer.js

// ✅ Экспорт ИМЕННОЙ функции (как у вас в index.js: `import { createTimer } ...`)
//    Плюс оставляем default с тем же API для обратной совместимости.
export function createTimer(mountEl, opts = {}) {
  ensureTimerStyles();

  // --- Параметры по умолчанию
  let fontPx = Number(opts.fontPx ?? 34);
  let freezeAtZero = opts.freezeAtZero ?? true;
  let showDays = Boolean(opts.showDays ?? true);
  let dayDigits   = opts.dayDigits ?? 2;

  // --- Состояние
  let rafId = null;
  let running = false;
  let mode = "idle";              // 'idle' | 'countdown'
  let targetTs = null;            // миллисекунды
  let activateTs = null;          // опционально — с какого момента «оживает» таймер
  let lastRenderedSec = null;

  // --- Разметка
  const root = mountEl;
  root.classList.add("jmtg-timer");
  root.innerHTML = `
    <div class="jmtg-timer__wrap">      
      <div class="jmtg-timer__digits" aria-live="off">
        <span class="timer-num" data-part="d">00</span>
        <span class="timer-sep" data-part="d-sep">:</span>
        <span class="timer-num" data-part="h">00</span>
        <span class="timer-sep">:</span>
        <span class="timer-num" data-part="m">00</span>
        <span class="timer-sep">:</span>
        <span class="timer-num" data-part="s">00</span>
      </div>
    </div>
  `;

  // Ссылки
  const elD    = root.querySelector('[data-part="d"]');
  const elDSep = root.querySelector('[data-part="d-sep"]');
  const elH    = root.querySelector('[data-part="h"]');
  const elM    = root.querySelector('[data-part="m"]');
  const elS    = root.querySelector('[data-part="s"]');
  const lblRow = root.querySelector('.jmtg-timer__labels');

  // --- Рисование
  function pad2(n) {
    n = Math.floor(Math.max(0, n));
    return (n < 10 ? "0" : "") + String(n);
  }

  function renderFromSeconds(total) {
    // Ограничение на отрицательные значения
    if (total <= 0) {
      elD.textContent = "00";
      elH.textContent = "00";
      elM.textContent = "00";
      elS.textContent = "00";
      // Когда дней нет — скрываем ведущий блок дней
      elD.style.display = showDays ? "inline-block" : "none";
      if (elDSep) elDSep.style.display = showDays ? "inline-block" : "none";
      return;
    }

    let days = 0, hours = 0, minutes = 0, seconds = 0;
    if (showDays && total >= 86400) {
      days = Math.floor(total / 86400);
      total -= days * 86400;
    }
    hours = Math.floor(total / 3600);
    total -= hours * 3600;
    minutes = Math.floor(total / 60);
    seconds = Math.floor(total - minutes * 60);

    if (showDays) {
      elD.style.display = "inline-block";
      if (elDSep) elDSep.style.display = "inline-block";
      elD.textContent = pad2(days);
    } else {
      elD.style.display = "none";
      if (elDSep) elDSep.style.display = "none";;
    }
    elH.textContent = pad2(hours);
    elM.textContent = pad2(minutes);
    elS.textContent = pad2(seconds);
  }

  function renderZero() {
    renderFromSeconds(0);
  }

  // --- Петля
  function tick() {
    rafId = null;

    if (!running) return;

    const now = Date.now();

    if (mode === "countdown") {
      // Если задана точка активации и она ещё не наступила — отображаем разницу ДО цели,
      // но не «крутим» чаще, чем раз в секунду.
      const sec = Math.floor((targetTs - now) / 1000);

      if (sec !== lastRenderedSec) {
        lastRenderedSec = sec;
        if (sec <= 0) {
          renderZero();
          if (freezeAtZero) {
            pauseCountdown();
          }
        } else {
          renderFromSeconds(sec);
        }
      }
    }

    // Планируем следующий тик
    if (running) rafId = requestAnimationFrame(tick);
  }

  // --- Публичное API

  // Счётчик вниз до `target` (Date | number | string), активироваться можно с `activate` (необязательно).
  function setCountdown(target, activate = null, options = {}) {
    // Нормализуем время
    const toMs = (v) => (v == null ? null :
      (typeof v === "number" ? v :
       (v instanceof Date ? v.getTime() : new Date(v).getTime())));

    targetTs = toMs(target);
    activateTs = toMs(activate);
    if (options && typeof options.freezeAtZero === "boolean") {
      freezeAtZero = options.freezeAtZero;
    }
    mode = "countdown";

    // Мгновенно перерисуемся один раз
    if (isFinite(targetTs)) {
      const now = Date.now();
      const sec = Math.floor((targetTs - now) / 1000);
      lastRenderedSec = null; // заставим перерисовать
      if (sec <= 0) {
        renderZero();
      } else {
        renderFromSeconds(sec);
      }
    } else {
      // некорректная цель — рисуем нули и ставим паузу
      renderZero();
      pauseCountdown();
    }
  }

  function pauseCountdown() {
    running = false;
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  function resumeCountdown() {
    if (mode !== "countdown") return;
    if (!running) {
      running = true;
      rafId = requestAnimationFrame(tick);
    }
  }

  // Совместимость с возможными старым вызовами
  function start() { resumeCountdown(); }
  function pause() { pauseCountdown(); }
  function reset() { renderZero(); pauseCountdown(); }
  function set(seconds) {
    // прямое выставление секунд (на случай если где-то используется)
    lastRenderedSec = null;
    renderFromSeconds(Number(seconds) || 0);
  }
  function getSeconds() {
    if (!isFinite(targetTs)) return 0;
    const diff = Math.floor((targetTs - Date.now()) / 1000);
    return Math.max(0, diff);
  }
  function isRunning() { return running; }
  function destroy() {
    pauseCountdown();
    try { root.innerHTML = ""; } catch {}
  }

  return {
    el: root,
    // основной API
    setCountdown, pauseCountdown, resumeCountdown, showZero: renderZero,
    // совместимость
    start, pause, reset, set, getSeconds, isRunning, pauseCountdown, destroy
  };

}

// --- Стили один раз на страницу
function ensureTimerStyles() {
  const id = "jmtg-timer-css";
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = `
    .jmtg-timer {
      --timer-color: #cfd2d6;
      --timer-font: 64px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      letter-spacing: 0.5px;
      color: var(--timer-color);
      user-select: none;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
    }
    .jmtg-timer__row { display: inline-flex; align-items: center; }
    .jmtg-timer .timer-num {
      font-size: var(--timer-font);
      font-weight: 700;
      line-height: 1;
      min-width: 2ch;
      text-align: center;
    }
    .jmtg-timer .timer-sep { 
      display: inline-block;
      padding: 0 3px;
      font-size: calc(var(--timer-font) * 0.9);
      opacity: 0.8;
    }
  `;
  document.head.appendChild(style);
}

// default-экспорт для совместимости (если где-то делали `import timer from '...'; timer.createTimer(...)`)
export default { createTimer };
