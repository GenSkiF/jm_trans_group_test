const NOTIF_SOUND_URL = "/frontend/assets/light-hearted-message-tone.mp3";

let notifAudio = null;
let canPlay = false;

// 1) Праймим аудио на первом любом действии пользователя
export function setupNotifPriming() {
  const prime = () => {
    try {
      if (!notifAudio) {
        notifAudio = new Audio(NOTIF_SOUND_URL);
        notifAudio.load();
      }
      canPlay = true;
    } catch (e) {}
    window.removeEventListener('click', prime, true);
    window.removeEventListener('touchstart', prime, true);
    window.removeEventListener('keydown', prime, true);
  };
  window.addEventListener('click', prime, true);
  window.addEventListener('touchstart', prime, true);
  window.addEventListener('keydown', prime, true);
}

// Оставляем на месте: ручной вызов, если где-то уже используешь
export function primeNotifSound() {
  if (!notifAudio) {
    notifAudio = new Audio(NOTIF_SOUND_URL);
    notifAudio.load();
  }
  canPlay = true;
}

// 2) Безопасное воспроизведение звука
let lastPlay = 0;
function playNotifSound() {
  if (!canPlay) return;                 // без прайминга — молчим (политика браузера)
  const now = Date.now();
  if (now - lastPlay < 600) return;     // анти-дребезг
  try {
    notifAudio && notifAudio.currentTime !== undefined && (notifAudio.currentTime = 0);
    notifAudio && notifAudio.play && notifAudio.play().catch(()=>{});
    lastPlay = now;
  } catch (e) {}
}

// ——— системный тост/уведомление (без падений) ———
function showSystemNotification(title, body) {
  try {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted') {
      new Notification(title, { body });
    } else if (Notification.permission === 'default') {
      // тихо попросим разрешение, но не блокируем поток
      Notification.requestPermission().catch(()=>{});
    }
  } catch {}
}

export function notifyNewRequest(request) {
  const text = `🆕 Новая/обновлённая заявка: ${request.from || "-"} → ${request.to || "-"} (${request.cargo || ""})`;
  try { playNotifSound(); } catch {}
  try { showSystemNotification("Новая заявка", text); } catch {}
}

export function notifyEditedRequest(request) {
  const text = `✏️ Изменена заявка: ${request.from || "-"} → ${request.to || "-"} (${request.cargo || ""})`;
  try { playNotifSound(); } catch {}
  try { showSystemNotification("Заявка изменена", text); } catch {}
}

// чтобы handler add_comment в index.js не падал:
export function notifyNewComment(req, comment) {
  const text = `💬 Комментарий к заявке #${req?.id || ''}: ${comment?.text || ''}`;
  try { playNotifSound(); } catch {}
  try { showSystemNotification("Новый комментарий", text); } catch {}
}


// === Разрешение на системные уведомления (гладко, без падений) ===
export function requestNotificationPermission() {
  try {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
    return true;
  } catch (e) { return false; }
}

/* =====================  ⏰ ЗВОНОК ДЛЯ ПРИОРИТЕТОВ (каждые 30 минут)  ===================== */
/* НИЧЕГО из твоей логики выше не меняем. Только добавляем недостающие функции и состояние,
   чтобы импорты из api.js / index.js работали и «звонок» звенел у всех одновременно. */

/** Интервал между звонками (30 минут) */
const PRIORITY_INTERVAL_MS = 30 * 60 * 1000;

/** Изолированное состояние звонка, чтобы не конфликтовать с остальным кодом */
const PriorityRingerState = {
  ids: new Set(),   // id заявок со статусом "приоритет"
  timer: null,      // setInterval каждые 30 минут
  alignTO: null,    // setTimeout до ближайшей "ровной" точки (:00 / :30)
  installed: false, // защита от повторной инициализации
};

/** Проверка: есть ли среди приоритетных заявок такая, у которой ЗАПУЩЕН таймер */
function hasAnyPriorityWithRunningTimer() {
  try {
    const timers = window.__reqTimers;
    if (!timers || typeof timers.get !== "function") return false;

    for (const id of PriorityRingerState.ids) {
      const t = timers.get(String(id)) || timers.get(Number(id));

      // основной путь: у таймера есть isRunning()
      if (t && typeof t.isRunning === "function" && t.isRunning()) {
        return true;
      }
      // запасной путь: секунды считаются (>0) — таймер активен
      if (t && typeof t.getSeconds === "function") {
        const sec = Number(t.getSeconds());
        if (Number.isFinite(sec) && sec > 0) return true;
      }
    }
  } catch (_) {}
  return false;
}

/** Локальная проверка статуса на "приоритет" (многоязычно) */
function isPriorityStatusLocal(status) {
  if (!status) return false;
  const s = String(status).toLowerCase();
  return s.includes('prior') || s.includes('приор') || s.includes('პრიო');
}

/** Один «дзынь», если есть хотя бы один приоритет */
function ringOncePriority() {
  if (PriorityRingerState.ids.size === 0) return;
  if (!hasAnyPriorityWithRunningTimer()) return; // ← добавили проверку таймеров

  try { playNotifSound(); } catch {}

  try {
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification("Приоритетные заявки", {
        body: "Есть заявки со статусом «Приоритет». Проверьте список.",
        silent: false,
      });
    }
  } catch {}
}

/** Выравниваем старт по времени: ближайшие :00 или :30, затем каждые 30 минут */
function scheduleAlignedStart() {
  clearTimeout(PriorityRingerState.alignTO);
  PriorityRingerState.alignTO = null;

  const now = new Date();
  const msFromHalfHour =
    (now.getMinutes() % 30) * 60_000 + now.getSeconds() * 1000 + now.getMilliseconds();
  const msToNextTick = (PRIORITY_INTERVAL_MS - msFromHalfHour) % PRIORITY_INTERVAL_MS;

  const delay = Math.max(1000, msToNextTick); // небольшой зазор

  PriorityRingerState.alignTO = setTimeout(() => {
    PriorityRingerState.alignTO = null;
    ringOncePriority(); // первый «дзынь» точно на ровной отметке
    clearInterval(PriorityRingerState.timer);
    PriorityRingerState.timer = setInterval(ringOncePriority, PRIORITY_INTERVAL_MS);
  }, delay);
}

function startIfNeeded() {
  if (PriorityRingerState.ids.size === 0) return;
  if (PriorityRingerState.timer || PriorityRingerState.alignTO) return;
  scheduleAlignedStart();
}

function stopIfEmpty() {
  if (PriorityRingerState.ids.size > 0) return;
  clearInterval(PriorityRingerState.timer);
  PriorityRingerState.timer = null;
  clearTimeout(PriorityRingerState.alignTO);
  PriorityRingerState.alignTO = null;
}

/** Полная замена набора id приоритетных заявок */
export function setPriorityIds(ids = []) {
  PriorityRingerState.ids = new Set((Array.isArray(ids) ? ids : []).map(String));
  if (PriorityRingerState.ids.size > 0) startIfNeeded(); else stopIfEmpty();
}

/** Добавить id в набор приоритетных */
export function addPriority(id) {
  if (id == null) return;
  PriorityRingerState.ids.add(String(id));
  startIfNeeded();
}

/** Удалить id из набора приоритетных */
export function removePriority(id) {
  if (id == null) return;
  PriorityRingerState.ids.delete(String(id));
  stopIfEmpty();
}

/** Инициализация «звонка» (идемпотентно) */
export function installPriorityRinger() {
  if (PriorityRingerState.installed) return;
  PriorityRingerState.installed = true;

  // Праймим звук по первому действию пользователя (браузерные правила автоплея)
  try { setupNotifPriming(); } catch {}

  // Жизненный цикл страницы:
  //  - в фоне: стопаем интервал и отложенный запуск, чтобы НЕ было «догоняющего» звонка
  //  - при возвращении: заново выравниваем старт на ближайшие :00/:30 БЕЗ мгновенного ring
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      clearInterval(PriorityRingerState.timer);
      PriorityRingerState.timer = null;
      clearTimeout(PriorityRingerState.alignTO);
      PriorityRingerState.alignTO = null;
      return;
    }

    if (document.visibilityState === "visible") {
      if (PriorityRingerState.ids.size > 0) {
        clearInterval(PriorityRingerState.timer);
        PriorityRingerState.timer = null;
        clearTimeout(PriorityRingerState.alignTO);
        PriorityRingerState.alignTO = null;
        // важное изменение: без ringOncePriority() — только пере-выравнивание
        scheduleAlignedStart();
      }
    }
  });
}


/** Обработка WS-сообщений для поддержания набора приоритетных id в актуальном состоянии */
export function handleWsForPriority(msg) {
  try {
    const act = msg?.action || msg?.type;

    // Полная синхронизация: сервер прислал все заявки
    if (act === 'sync_all' && Array.isArray(msg?.data)) {
      const ids = msg.data.filter(r => r && isPriorityStatusLocal(r.status)).map(r => r.id);
      setPriorityIds(ids);
      return;
    }

    // Точечные изменения (new_request / request_updated / edit_request и т.п.)
    const data = msg?.data || msg?.request || {};
    const id = String(data?.id || data?.request_id || msg?.id || '');
    const status = data?.status || data?.request?.status || msg?.status;

    if (!id || typeof status === 'undefined' || status === null) return;

    if (isPriorityStatusLocal(status)) addPriority(id);
    else removePriority(id);
  } catch {}
}
/* =====================  /ЗВОНОК ДЛЯ ПРИОРИТЕТОВ  ===================== */

// чтобы старый код в index.js, который зовёт глобально, не падал:
window.requestNotificationPermission = requestNotificationPermission;

