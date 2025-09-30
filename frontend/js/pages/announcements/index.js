import { STATUS, STATUS_LABEL, STATUS_BADGE } from '../../constants/status.js';
import { WebSocketService } from '../../services/api.js';
import { renderDriversSection, handleDriverMenuAction, downloadDriverFile, showDriverContextMenu } from './drivers_card.js';

import {
    primeNotifSound,
    setupNotifPriming,
    notifyNewRequest,
    notifyNewComment,
    installPriorityRinger,
    setPriorityIds,
    addPriority,
    removePriority
  } from '../../services/notifications.js';
import { createTimer } from '../../pages/announcements/components/timer.js'; 

// Импортируй функцию плюса
import { plusAnnouncements } from '../../plus.js';
import { openEditRequestModal } from '/frontend/js/pages/announcements/edit-requests.js';
import { renderFlagSpan } from '../../components/flag-icon.js';
import { openRouteOnMapForRequest } from '../maps/index.js';

let announcements = [];
window.announcements = announcements; 
// === [MAP COMPASS CLICK] ===
// ВАЖНО: слушаем в фазе захвата (true), чтобы опередить клик по карточке
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action="open-route"], [data-action="open-on-map"]');
  if (!btn) return;

  // Не даём карточке перехватить клик
  e.preventDefault();
  e.stopPropagation();

  const id = Number(btn.dataset.rid || btn.dataset.id);
  const req = (window.announcements || []).find(r => Number(r.id) === id);
  if (!req) return;

  // запомним последнюю заявку — карта может это использовать
  window.__lastRouteRequestId = id;

  if (typeof window.showSection === 'function') {
    window.showSection('maps');
  }

  // ждём один тик, чтобы секция "карта" отрисовалась
  await new Promise(r => setTimeout(r, 0));

  // Глобальная функция карты (экспортируем ниже в maps/index.js)
  if (typeof window.openRouteOnMapForRequest === 'function') {
    window.openRouteOnMapForRequest(req);
  }
}, true); // 👈 capture=true

// Универсальный способ открыть карточку заявки по id (используем из карты)
if (!window.openRequestById) {
  window.openRequestById = function (id) {
    // Пытаемся найти кликабельный элемент заявки и кликнуть его, не меняя вашу логику
    const selectors = [
      `[data-rid="${id}"] [data-action="open-request"]`,
      `[data-id="${id}"] [data-action="open-request"]`,
      `[data-request-id="${id}"] [data-action="open-request"]`,
      `[data-rid="${id}"]`,
      `[data-id="${id}"]`,
      `[data-request-id="${id}"]`,
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) { el.click(); return true; }
    }
    return false;
  };
}


let currentStatusFilter = 'all';
let searchQuery = '';
let cityFilter = '';
let expandedCardId = null;
window.__reqTimers = window.__reqTimers || new Map(); // глобальный кэш таймеров по id заявки
window.__autoByDriversPriority = window.__autoByDriversPriority || new Set();
window.__autoByDriversCurrent  = window.__autoByDriversCurrent  || new Set();

// --- Основная инициализация ---
export function initAnnouncements(data) {
  // НЕ ЗАМЕНЯЕМ announcements, а очищаем и наполняем!
  announcements.length = 0;
  if (Array.isArray(data)) {
    data.forEach(item => announcements.push(item));
  }
  announcements.forEach(req => {
    if (!Array.isArray(req.comments)) req.comments = [];
    else req.comments = req.comments.filter(c => c && typeof c === 'object');
  });
  renderStatusFilters();
  announcements.forEach(evaluateAutoStatus);
  // Синхронизируем список приоритетных заявок и включаем глобальный «звонок»
  setPriorityIds(announcements.filter(r => isPriorityStatus(r.status)).map(r => r.id));
  installPriorityRinger();
  renderRequestList();
}

// ——— статусы
function isPriorityStatus(status) {
  return String(status || '').toLowerCase().trim() === 'priority';
}
function isActiveStatus(status) {
  return String(status || '').toLowerCase().trim() === 'active';
}
function isCurrentStatus(status) {
  return String(status || '').toLowerCase().trim() === 'current';
}
function isBlockedForTimerEdit(status) {
  const s = String(status || '').toLowerCase().trim();
  return s === 'closed' || s === 'done';
}

// ——— булевы «груз готов»
function parseBoolLike(v) {
  if (v === true) return true;
  const s = String(v || '').toLowerCase().trim();
  return ['1','true','да','yes','ready','готов','готово'].some(x => s.includes(x));
}

// ——— берём дату загрузки из разных возможных полей
function pickLoadingDate(req) {
  // 1) одиночные поля (как было)
  let cand = req.loading_date || req.loadingDate || req.load_date || req.loading || req.date_load;

  // 2) если не нашли — пробуем массив дат
  if (!cand && Array.isArray(req.loading_dates) && req.loading_dates.length > 0) {
    // берём самую раннюю валидную дату из объектов массива
    const candidates = req.loading_dates
      .map(x => (x && (x.date || x.loading_date || x.dt || x.when)))
      .filter(Boolean)
      .map(v => new Date(v))
      .filter(d => !isNaN(d.getTime()));
    if (candidates.length) {
      cand = new Date(Math.min(...candidates.map(d => d.getTime())));
    }
  }

  if (!cand) return null;
  const d = (cand instanceof Date) ? cand : new Date(cand);
  return isNaN(d.getTime()) ? null : d;
}

function pickTimerTarget(req) {
  // если вручную задана цель — используем её
  if (req && req.timer_target) {
    const d = new Date(req.timer_target);
    if (!isNaN(d)) return d;
  }
  // иначе — обычная дата погрузки
  return pickLoadingDate(req);
}

function getRemainingTrucks(req) {
  if (!Array.isArray(req.loading_dates)) return null;
  return req.loading_dates.reduce((sum, ld) => {
    const n = Number(ld && ld.truck_count);
    return sum + (Number.isFinite(n) ? n : 0);
  }, 0);
}

function countAssignedDrivers(req) {
  let n = 0;
  if (Array.isArray(req.drivers)) n += req.drivers.filter(Boolean).length;
  if (Array.isArray(req.loading_dates)) {
    for (const ld of req.loading_dates) {
      if (Array.isArray(ld?.drivers)) n += ld.drivers.filter(Boolean).length;
    }
  }
  if (Number.isFinite(+req.drivers_count)) n = Math.max(n, Number(req.drivers_count));
  if (req.driver) n = Math.max(n, 1);
  return n;
}


// --- Рендер фильтров по статусу ---
function renderStatusFilters() {
  const el = document.getElementById('announcements-filters');
  if (!el) return;
  el.innerHTML = `
    <div class="d-flex align-items-center mb-3 gap-2 flex-wrap" id="ann-panel">
      <div class="ms-3 d-flex gap-1 flex-wrap" id="status-bar">
        <button class="btn btn-outline-info" data-status="all">ყველა</button>
        <button class="btn btn-outline-danger" data-status="priority">პრიორიტეტი</button>
        <button class="btn btn-outline-success" data-status="active">აქტიური</button>
        <button class="btn btn-outline-warning" data-status="current">მიმდინარე</button>
        <button class="btn btn-outline-secondary" data-status="closed">დახურული</button>
        <button class="btn btn-outline-dark" data-status="done">გაუქმებული</button>
      </div>
    </div>
  `;
  document.querySelectorAll('#status-bar button').forEach(btn => {
    btn.onclick = () => setStatusFilter(btn.getAttribute('data-status'));
    btn.classList.toggle('active', btn.getAttribute('data-status') === currentStatusFilter);
  });
}
// --- Смена фильтра по статусу ---
function setStatusFilter(status) {
  currentStatusFilter = status;
  renderStatusFilters();
  renderRequestList();
}

// Приводим к нижнему регистру + обрезаем пробелы
const norm = (s) => String(s ?? '').toLowerCase().trim();

window.onGlobalSearch = function() {
  const raw = document.getElementById('search-input')?.value || '';
  searchQuery = norm(raw);
  renderRequestList();
};

// Вызов из карты: отфильтровать по названию города и открыть список
window.filterAnnouncementsByCity = function(cityName) {
  const input = document.getElementById('search-input');
  cityFilter = norm(cityName);
  // Подставим текст в поле поиска, чтобы пользователь видел критерий
  if (input) input.value = cityName || '';
  renderRequestList();
};

// Сброс фильтра при нажатии на кнопку «Заявки» (если id другой — поменяйте селектор)
document.addEventListener('click', (e) => {
  const btn = e.target.closest('#btn-announcements');
  if (!btn) return;
  cityFilter = '';
  searchQuery = '';
  const input = document.getElementById('search-input');
  if (input) input.value = '';
  renderRequestList();
});



// --- Основной рендер списка заявок ---
function renderRequestList() {
  const container = document.getElementById('ann-list');
  if (!container) return;
  container.innerHTML = '';

  let filtered = announcements.filter(req => {
    const statusOk = (currentStatusFilter === "all" || req.status === currentStatusFilter);

    // нормализуем все сравнения
    const f = (v) => String(v ?? '');
    const fields = [
      f(req.from), f(req.to),
      f(req.from_city), f(req.to_city), f(req.city_from), f(req.city_to),
      f(req.from_country), f(req.to_country),
      f(req.cargo), f(req.transport), f(req.user), f(req.note),
      f(req.id), f(req.date), f(req.price)
    ].map(norm);

    // 1) Фильтр по ГОРОДУ (пришёл с карты или вписан вручную)
    const byCityOk = !cityFilter || fields.some(v => v.includes(cityFilter));

    // 2) Общий поиск по тексту (то, что в поле search-input)
    const bySearchOk = !searchQuery || fields.some(v => v.includes(searchQuery));

    return statusOk && byCityOk && bySearchOk;
  });


  if (filtered.length === 0) {
    container.innerHTML = `<div class="alert alert-info mt-2">Нет заявок</div>`;
    return;
  }

  // Определи порядок статусов
  const statusOrder = {
    "priority": 0,
    "active": 1,
    "current": 2,
    "closed": 3,
    "done": 4,
    // любые другие будут после
  };

  // Сортируем filtered перед отображением:
  filtered
    .slice()
    .sort((a, b) => {
      // Сортировка по статусу (сначала важные)
      const aOrder = statusOrder[a.status] !== undefined ? statusOrder[a.status] : 99;
      const bOrder = statusOrder[b.status] !== undefined ? statusOrder[b.status] : 99;
      if (aOrder !== bOrder) return aOrder - bOrder;
      // Потом — по дате/времени (сначала новые)
      const at = (a.timestamp || a.date || '');
      const bt = (b.timestamp || b.date || '');
      return bt.localeCompare(at);
    })
    .forEach(req => {
      container.appendChild(renderRequestCard(req));
    });
}
window.renderRequestList = renderRequestList; // ← экспорт в глобал

// --- Вспомогательные статусы и цвета ---
function statusColor(status) {
  switch((status || '').toLowerCase()) {
    case 'priority': return 'danger';
    case 'active': return 'success';
    case 'current': return 'warning';
    case 'closed': return 'secondary';
    case 'done': return 'dark';
    default: return 'primary';
  }
}

// --- Карточка заявки: три секции ---
function renderRequestCard(req) {
  const card = document.createElement('div');
  card.className = 'request-card shadow-sm rounded mb-3 p-3 bg-white animate__animated animate__fadeIn';

  // --- Компактная шапка ---
  card.innerHTML = ` 
    <div class="d-flex justify-content-between align-items-center card-header" style="cursor:pointer">
      <div>
        <b>
            <button class="btn btn-light btn-sm"
              title="Показать маршрут на карте"
              data-action="open-route"
              data-rid="${req.id}">🧭</button>
            ${req.from_country ? renderFlagSpan(req.from_country) : ""}
            ${req.from || '-'} 
            → 
            ${req.to || '-'}
            ${req.to_country ? renderFlagSpan(req.to_country) : ""}
        </b><br>

        <span class="mini-row">
          <span>📦 ${req.cargo || '-'}</span>
          <span>🌡️ ${req.temperature || '-'}</span>
        </span><br>
        <span class="mini-row">
          <span>🚛 ${req.transport || '-'}</span>
          <span>⚖️ ${req.weight || '-'}ტ.</span>
        </span>
      </div>
      <div class="req-timer-slot"
        data-id="${req.id}"
        style="flex:1 1 240px; min-width:160px; display:flex; align-items:center; justify-content:center; align-self:stretch; margin: 0 8px;">
      </div>

      <div class="text-end">
        <span class="badge bg-${statusColor(req.status)} status-badge"
              data-id="${req.id}"
              style="cursor: pointer; user-select: none;">
          ${statusLabel(req.status) || '-'}
        </span>
        <div>${req.user || '-'}</div>
        <small>${formatDate(req.timestamp || req.date)}</small>
        <!-- Кнопка "Редактировать" можешь реализовать позже, через отдельную модалку -->
      </div>
    </div>
    <div class="request-details mt-3" style="display:${expandedCardId === req.id ? 'block' : 'none'}"></div>
  `;

  // Делегирование клика по компасу в списке заявок
  const annListEl = document.getElementById('ann-list');
  if (annListEl && !annListEl.__compassBound) {
    annListEl.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action="open-route"]');
      if (!btn) return;
      const rid = btn.getAttribute('data-rid');
      const item = (window.announcements || []).find(r =>
        String(r.id) === String(rid) || String(r.request_id) === String(rid)
      );
      if (item) {
        // для карты: помечаем заявку, на которую хотим фокус
      window.__lastRouteRequestId = item.id;
        // Показать карту и построить маршрут
        if (typeof window.showSection === 'function') window.showSection('maps');
        openRouteOnMapForRequest(item);
      }
    });
    annListEl.__compassBound = true;
  }

  // --- Таймер: создать/переиспользовать, покрасить и включить/остановить обратный отсчёт ---
  (() => {
    const slot = card.querySelector('.req-timer-slot');
    if (!slot) return;

    // кэш экземпляров
    window.__autoPriority = window.__autoPriority || new Set(); // ids, которым уже проставили priority авто
    const timers = window.__reqTimers;

    // 1) Создать/переиспользовать timerApi
    let timerApi = timers.get(req.id);
    if (timerApi && timerApi.el) {
      try { slot.innerHTML = ''; slot.appendChild(timerApi.el); } catch {}
    } else {
      timerApi = createTimer(slot, { initialSeconds: 0 /* , fontPx: 80 если ты это используешь в createTimer */ });
      timers.set(req.id, timerApi);
    }

    // 2) Цвет по статусу (приоритет/активный/остальное)
    {
      const el = timerApi.el || slot.querySelector('.jmtg-timer');
      if (el) {
        // по умолчанию — серый
        let color = '#cfd2d6';
        if (isPriorityStatus(req.status)) {
          color = '#d32f2f';   // красный для "Приоритет"
        } else if (isActiveStatus(req.status)) {
          color = '#198754';   // зелёный для "Активный" (Bootstrap success)
        }
        el.style.setProperty('--timer-color', color);
      }
    }

    // ПКМ по таймеру — корректировка даты (кроме текущих/закрытых/отменённых)
    slot.oncontextmenu = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (isBlockedForTimerEdit(req.status)) return;
      showTimerAdjustMenu(e, req.id);
    };

    // --- если статус уже "current" → остановить таймер
    if (isCurrentStatus(req.status)) {
      if (typeof timerApi.showZero === 'function') timerApi.showZero();
      if (typeof timerApi.pauseCountdown === 'function') timerApi.pauseCountdown();
      return;
    }

    // --- если машин не осталось → перевести в "current" ОДИН раз и остановить таймер
    window.__autoToCurrent = window.__autoToCurrent || new Set();
    const remaining = getRemainingTrucks(req);
    if (remaining !== null && remaining <= 0) {
      if (!window.__autoToCurrent.has(req.id)) {
        window.__autoToCurrent.add(req.id);
        changeRequestStatus(req.id, 'current'); // пошлёт WS + локально обновит
      }
      if (typeof timerApi.showZero === 'function') timerApi.showZero();
      if (typeof timerApi.pauseCountdown === 'function') timerApi.pauseCountdown();
      return;
    }

    const cargoReady = parseBoolLike(req.cargo_ready || req.ready || req.is_ready || req.isCargoReady);
    evaluateAutoStatus(req); // ← авто-перевод по правилу "груз готов"

    // 1) цель таймера: ручная или дата погрузки
    const manualTarget = req.timer_target ? new Date(req.timer_target) : null;
    const targetDate   = pickTimerTarget(req);

    

    // 2) если «груз готов», НО есть ручной таймер — даём таймеру работать
    if (cargoReady && !manualTarget) {
      if (typeof timerApi.showZero === 'function') timerApi.showZero();
      if (typeof timerApi.pauseCountdown === 'function') timerApi.pauseCountdown();
      return;
    }

    const enabledForTimer =
      isActiveStatus(req.status) || isPriorityStatus(req.status) || isCurrentStatus(req.status);

    if (targetDate && enabledForTimer) {
      const target = new Date(targetDate);
      const activate = new Date(target.getTime() - 32 * 60 * 60 * 1000);

      if (typeof timerApi.setCountdown === 'function') {
        timerApi.setCountdown(target.getTime(), activate.getTime(), { freezeAtZero: true });
        timerApi.resumeCountdown(); // ← запуск
      }
      if (typeof timerApi.resumeCountdown === 'function') timerApi.resumeCountdown();

      // ← ВАЖНО: автоприоритет запускаем именно при работающем таймере
      ensureAutoPriority(req, timerApi);
    } else {
      timerApi.pauseCountdown();
      if (typeof timerApi.pauseCountdown === 'function') timerApi.pauseCountdown();
    }
  })();



  card.querySelector('.status-badge').oncontextmenu = function(e) {
    e.preventDefault();
    showStatusMenu(e, req.id);
   }; 

  // --- Клик по шапке: раскрытие/сворачивание ---
  card.querySelector('.card-header').onclick = (ev) => {
    if (ev.target.classList.contains('status-badge')) return; // ← предотвращаем конфликт!
    expandedCardId = (expandedCardId === req.id) ? null : req.id;
    renderRequestList();
  };

  


  // --- Внутренние секции ---
  const details = card.querySelector('.request-details');
  if (expandedCardId === req.id) {
    details.innerHTML = renderRequestSections(req);
    setTimeout(() => {
      details.querySelectorAll('.driver-download-btn').forEach(btn => {
        btn.onclick = function() {
          const task_id = this.getAttribute('data-task-id');
          const filename = this.getAttribute('data-filename');
          downloadDriverFile(task_id, filename);
        };
      });
      const addDriverBtn = details.querySelector(`#add-driver-btn-${req.id}`);
      if (addDriverBtn) {
        addDriverBtn.onclick = () => handleDriverMenuAction(req.id);
      }
      // --- ДОБАВЛЯЕМ: обработчик ПКМ по водителю ---
      details.querySelectorAll('.driver-card').forEach(card => {
        card.oncontextmenu = function(e) {
          e.preventDefault();
          showDriverContextMenu(e, req.id, Number(card.getAttribute('data-driver-idx')));
        };
      });
    }, 0);
   

    // Контекстное меню (ПКМ) только на первую секцию (основные данные)
    const firstSection = details.querySelector('.request-section-cell');
    if (firstSection) {
      firstSection.oncontextmenu = (e) => {
        e.preventDefault();
        showRequestContextMenu(e, req.id);
      };
    }
  }

  return card;
}

function statusLabel(status) {
  switch ((status || '').toLowerCase()) {
    case 'priority': return 'პრიორიტეტი';
    case 'active': return 'აქტიური';
    case 'current': return 'მიმდინარე';
    case 'closed': return 'დახურული';
    case 'done': return 'გაუქმებული';
    case 'all': return 'ყველა';
    default: return status || '-';
  }
}

function showStatusMenu(e, requestId) {
  // Удалить прошлое меню, если было
  document.getElementById('status-menu')?.remove();

  const statuses = [
    { key: "priority", color: "danger", label: "პრიორიტეტი" },
    { key: "active", color: "success", label: "აქტიური" },
    { key: "current", color: "warning", label: "მიმდინარე" },
    { key: "closed", color: "secondary", label: "დახურული" },
    { key: "done", color: "dark", label: "გაუქმებული" }
  ];

  // Меню
  const menu = document.createElement('div');
  menu.id = 'status-menu';
  menu.style = `
    position: fixed;
    left: ${e.clientX}px; top: ${e.clientY}px;
    z-index: 9999;
    background: #fff; box-shadow: 0 3px 24px #0002;
    border-radius: 8px; padding: 8px 0; min-width: 120px;
  `;

  statuses.forEach(st => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `dropdown-item text-start btn btn-${st.color} w-100 mb-1 py-1`;
    btn.innerText = st.label;
    btn.onclick = () => {
      changeRequestStatus(requestId, st.key);
      menu.remove();
    };
    menu.appendChild(btn);
  });

  // Клик вне меню — закрыть
  setTimeout(() => {
    window.addEventListener('mousedown', function hideMenu(ev) {
      if (!menu.contains(ev.target)) {
        menu.remove();
        window.removeEventListener('mousedown', hideMenu);
      }
    });
  }, 10);

  document.body.appendChild(menu);
}

function showTimerAdjustMenu(e, requestId) {
  // Сносим прошлое меню, если было
  document.getElementById('timer-edit-menu')?.remove();

  const menu = document.createElement('div');
  menu.id = 'timer-edit-menu';
  menu.style = `
    position: fixed;
    left: ${e.clientX}px; top: ${e.clientY}px;
    z-index: 10000;
    background: #fff; box-shadow: 0 6px 24px #0003;
    border-radius: 10px; padding: 10px; min-width: 220px;
  `;
  menu.innerHTML = `
    <div style="font-weight:700; margin-bottom:6px;">Сдвиг таймера</div>

    <div class="mb-2" style="display:flex; align-items:center; gap:8px;">
      <label style="min-width:48px; margin:0;">Дни</label>
      <input id="adj-days" type="number" class="form-control form-control-sm" value="0" step="1" style="max-width:90px;">
    </div>

    <div class="mb-2" style="display:flex; align-items:center; gap:8px;">
      <label style="min-width:48px; margin:0;">Часы</label>
      <input id="adj-hours" type="number" class="form-control form-control-sm" value="0" step="1" min="-23" max="23" style="max-width:90px;">
    </div>

    <div class="mb-2" style="display:flex; align-items:center; gap:8px;">
      <label style="min-width:48px; margin:0;">Минуты</label>
      <input id="adj-minutes" type="number" class="form-control form-control-sm" value="0" step="1" min="-59" max="59" style="max-width:90px;">
    </div>

    <div class="d-flex justify-content-end gap-2">
      <button type="button" class="btn btn-sm btn-light" id="btn-cancel">Отмена</button>
      <button type="button" class="btn btn-sm btn-primary" id="btn-save">Сохранить</button>
    </div>
  `;


  document.body.appendChild(menu);

  // --- Живой предпросмотр: таймер сразу начинает обратный отсчёт от введённых значений
  const timerApiPreview = (window.__reqTimers && window.__reqTimers.get(requestId)) || null;
  const daysInput = menu.querySelector('#adj-days');
  const hoursInput = menu.querySelector('#adj-hours');
  const minutesInput = menu.querySelector('#adj-minutes');

  function updatePreview() {
    if (!timerApiPreview) return;
    const dd = parseInt(daysInput.value || '0', 10) || 0;
    const hh = parseInt(hoursInput.value || '0', 10) || 0;
    const mm = parseInt(minutesInput.value || '0', 10) || 0;

    const normMin = Math.max(-59, Math.min(59, mm));
    const deltaMs = ((dd * 24 + hh) * 60 + normMin) * 60 * 1000;

    const previewTarget = Date.now() + deltaMs;
    timerApiPreview.setCountdown(previewTarget, null, { freezeAtZero: true });
    timerApiPreview.resumeCountdown();
  }

  // Сразу запускаем предпросмотр при первом открытии (на 0 ничего не меняет)
  updatePreview();
  // И обновляем при каждом вводе
  [daysInput, hoursInput, minutesInput].forEach(inp => {
    if (inp) inp.addEventListener('input', updatePreview);
  });

  const req = announcements.find(r => String(r.id) === String(requestId));
  const base = pickLoadingDate(req) || new Date();

  const btnCancel = menu.querySelector('#btn-cancel');
  const btnSave   = menu.querySelector('#btn-save');

  const close = () => menu.remove();

  btnCancel.onclick = close;

  btnSave.onclick = async () => {
    const days    = parseInt(menu.querySelector('#adj-days').value || '0', 10) || 0;
    const hours   = parseInt(menu.querySelector('#adj-hours').value || '0', 10) || 0;
    const minutes = parseInt(menu.querySelector('#adj-minutes').value || '0', 10) || 0;

    // Нормируем минуты в диапазон [-59, 59] для предсказуемости
    const mm = Math.max(-59, Math.min(59, minutes));

    const deltaMs = ((days * 24 + hours) * 60 + mm) * 60 * 1000;
    const newDt   = new Date(Date.now() + deltaMs);

    // Сохраняем ТОЛЬКО ручную цель таймера, ничего больше не трогаем
    const patch = {
      timer_target: newDt.toISOString(),
      last_editor: (localStorage.getItem('jm_session_username') || 'user'),
      edit_reason: 'timer_adjust'
    };


    try {
      await WebSocketService.sendAndWait({
        action: "edit_request",
        id: requestId,
        data: patch
      });

      // Обновим локально и перерисуем
      req.timer_target = patch.timer_target;
      req.loading_date = patch.loading_date;
      if (patch.loading_dates) req.loading_dates = patch.loading_dates;
      req.ready = false;
      req.cargo_ready = false;
      req.is_ready = false;

      renderRequestList();
      close();
      showToast('Дата погрузки сдвинута', 'success');
    } catch (err) {
      showToast('Ошибка при сдвиге даты: ' + (err?.message || err), 'danger');
    }
  };

  // Закрытие по клику вне и по Esc
  setTimeout(() => {
    const onDown = (ev) => {
      if (!menu.contains(ev.target)) { close(); window.removeEventListener('mousedown', onDown); }
    };
    window.addEventListener('mousedown', onDown);
  }, 10);

  window.addEventListener('keydown', function onKey(ev) {
    if (ev.key === 'Escape') { close(); window.removeEventListener('keydown', onKey); }
  });
}

function ensureAutoPriority(req, timerApi) {
  // не трогаем закрытые/отменённые
  const status = (req.status || '').toLowerCase();
  if (status.includes('closed') || status.includes('закры') || status.includes('დახურულ') ||
      status.includes('done')   || status.includes('отмен') || status.includes('გაუქმ')) {
    return;
  }

  
  // если уже priority — тоже ничего не делаем
  if (isPriorityStatus(req.status)) return;

  // чистим прежний интервал, если уже висел на этом экземпляре
  if (timerApi.__prioInt) {
    try { clearInterval(timerApi.__prioInt); } catch {}
    timerApi.__prioInt = null;
  }

  const check = () => {
    // карточка могла обновиться
    if (!timerApi || typeof timerApi.getSeconds !== 'function') { stop(); return; }

    const sec = Number(timerApi.getSeconds());
    if (!Number.isFinite(sec)) return;

    // если меньше суток — переводим в приоритет один раз
    if (sec > 0 && sec <= 24 * 60 * 60) {
      if (!window.__autoPriority.has(req.id)) {
        window.__autoPriority.add(req.id);

        // Мгновенно подкрасим таймер в красный (до прихода пуша)
        try {
          const el = timerApi.el;
          if (el) el.style.setProperty('--timer-color', '#d32f2f');
        } catch {}

        // Меняем статус через существующую функцию (она сама пошлёт WS + локально обновит)
        changeRequestStatus(req.id, 'priority');
      }
      stop();
    }

    // если уже вручную перевели/прилетел PUSH — остановимся
    if (isPriorityStatus(req.status)) stop();
  };

  function stop() {
    if (timerApi.__prioInt) {
      try { clearInterval(timerApi.__prioInt); } catch {}
      timerApi.__prioInt = null;
    }
  }

  // Проверим сразу и затем раз в секунду
  check();
  timerApi.__prioInt = setInterval(check, 1000);
}



function changeRequestStatus(id, status) {
  // Меняем статус через WebSocket (или свой API)
  WebSocketService.sendAndWait({
    action: "set_request_status",
    id: id,
    data: { status }
  }).then(() => {
    showToast('სტატუსი შეიცვალა', 'success');
    const req = announcements.find(r => String(r.id) === String(id));
    if (req) {
      req.status = status;
      // Мгновенно обновим локальный набор для «звонка» (без ожидания WS)
       if (isPriorityStatus(status)) addPriority(id);
       else                          removePriority(id);
      renderRequestList();
    }
  }).catch(err => {
    showToast('შეცდომა სტატუსის შეცვლისას: ' + err.message, 'danger');
  });
}

function evaluateAutoStatus(req) {
  // Работает ТОЛЬКО когда "груз готов"
  const cargoReady = parseBoolLike(req.cargo_ready || req.ready || req.is_ready || req.isCargoReady);
  if (!cargoReady) return;

  // Не трогаем авто-статусы, если заявка уже закрыта/завершена
  const __s = String(req.status || '').toLowerCase().trim();
  if (__s === 'closed' || __s === 'done') return;

  const drv = countAssignedDrivers(req);

  // 1) НЕТ водителей → priority + таймер в нули
  if (drv <= 0 && !isPriorityStatus(req.status) && !window.__autoByDriversPriority.has(req.id)) {
    window.__autoByDriversPriority.add(req.id);
    const t = window.__reqTimers.get(req.id);
    if (t && typeof t.showZero === 'function') t.showZero();
    if (t && typeof t.pauseCountdown === 'function') t.pauseCountdown();
    changeRequestStatus(req.id, 'priority'); // пошлёт WS и локально обновит
    return;
  }

  // 2) ЕСТЬ водитель → current + таймер в нули
  if (drv > 0 && !isCurrentStatus(req.status) && !window.__autoByDriversCurrent.has(req.id)) {
    window.__autoByDriversCurrent.add(req.id);
    const t = window.__reqTimers.get(req.id);
    if (t && typeof t.showZero === 'function') t.showZero();
    if (t && typeof t.pauseCountdown === 'function') t.pauseCountdown();
    changeRequestStatus(req.id, 'current');
  }
}



// --- Три секции внутри карточки ---
function renderRequestSections(req) {
  return `
    <div class="request-sections-row">
      <div class="request-section-cell">
        <div><b>Маршрут:</b> ${req.from || '-'} → ${req.to || '-'}</div>
        <div><b>Груз:</b> ${req.cargo || '-'}</div>
        <div><b>Транспорт:</b> ${req.transport || '-'}</div>
        <div><b>Темп.:</b> ${req.temperature || '-'}</div>
        <div><b>Дата погрузки:</b> ${renderLoadingDates(req)}</div>
        <div><b>Вес:</b> ${req.weight || '-'}ტ.</div>
        <div><b>Цена:</b> ${req.price || '-'}</div>
        <div><b>Замечание:</b> ${req.note || '-'}</div>
      </div>
      <div class="request-section-cell">
        <b>💬 Комментарии:</b>
        <div class="comments-scroll" id="comments-${req.id}">
          ${Array.isArray(req.comments) && req.comments.length > 0
            ? req.comments.filter(c => c && typeof c === 'object').map(c => `<div><b>${c.user || '-'}</b>: ${c.text || ''}</div>`).join('')
            : '<i>Нет комментариев</i>'}
        </div>
        <form class="mt-2" onsubmit="return addComment(event, '${req.id}')">
          <input type="text" class="form-control form-control-sm" name="comment" placeholder="Добавить комментарий...">
          <button type="submit" class="btn btn-sm btn-outline-primary mt-1">Добавить</button>
        </form>
      </div>
      <div class="request-section-cell">
        ${renderDriversSection(req)}
      </div>
    </div>
  `;
}

function renderLoadingDates(req) {
  if (req.ready) {
    let truckCount = (typeof req.loading_dates?.[0]?.truck_count !== 'undefined')
      ? Number(req.loading_dates[0].truck_count)
      : 0;
    // Показывать даже если 0 маш.!
    return `<span style="color:#287b12;font-:600;">Груз готов (${truckCount} маш.)</span>`;
  }
  if (Array.isArray(req.loading_dates) && req.loading_dates.length > 0) {
    return req.loading_dates.map(ld =>
      `<span style="display:inline-block; margin-bottom:2px;">
        ${ld.date ? formatDate(ld.date) : '-'}
        <span class="text-muted ms-1">(${typeof ld.truck_count !== 'undefined' ? Number(ld.truck_count) : 0} маш.)</span>
      </span>`
    ).join('<br>');
  }
  return '-';
}



// --- Форматирование дат ---
function formatDate(dt) {
  if (!dt) return '-';
  try {
    let d = dt.split(/[T ]/)[0].split('-');
    let t = dt.split(/[T ]/)[1] ? dt.split(/[T ]/)[1].slice(0,5) : '';
    if (d.length === 3) return `${d[2]}.${d[1]}.${d[0]} ${t}`;
    return dt;
  } catch { return dt; }
}

function showRequestContextMenu(e, requestId) {
  document.getElementById('request-context-menu')?.remove();

  const menu = document.createElement('div');
  menu.id = 'request-context-menu';
  menu.style = `
    position: fixed;
    left: ${e.clientX}px; top: ${e.clientY}px;
    background: #fff; box-shadow: 0 3px 10px #0004;
    border-radius: 6px; padding: 6px 0;
    z-index: 10000;
    min-width: 140px;
  `;

  const editBtn = document.createElement('button');
  editBtn.className = 'dropdown-item btn btn-light w-100';
  editBtn.textContent = 'Редактировать';
  editBtn.onclick = () => {
    openEditRequestModal(announcements.find(r => String(r.id) === String(requestId)));
    menu.remove();
  };

  menu.appendChild(editBtn);

  document.body.appendChild(menu);

  // Закрыть по клику вне меню
  setTimeout(() => {
    window.addEventListener('mousedown', function closeMenu(ev) {
      if (!menu.contains(ev.target)) {
        menu.remove();
        window.removeEventListener('mousedown', closeMenu);
      }
    });
  }, 10);
}


// --- Добавление комментария ---
window.addComment = async function(event, id) {
  event.preventDefault();
  const form = event.target;
  const input = form.querySelector('input[name="comment"]');
  const text = input.value.trim();
  if (!text) return false;

  try {
    const resp = await WebSocketService.sendAndWait({
      action: "add_comment",
      task_id: id,
      comment: {
        user: localStorage.getItem('jm_session_username') || 'user',
        text,
        timestamp: new Date().toISOString().slice(0,16).replace('T',' ')
      }
    });
    input.value = '';
    if (resp.status === "success") {
      // имитируем приход PUSH самому себе...
      WebSocketService.callbacks['add_comment'] && WebSocketService.callbacks['add_comment']({
        action: 'add_comment',
        task_id: id,
        comment: {
          user: localStorage.getItem('jm_session_username') || 'user',
          text,
          timestamp: new Date().toISOString().slice(0,16).replace('T',' ')
        }
      });
    }
  } catch (err) {
    showToast('Ошибка добавления комментария: ' + err.message, 'danger');
  }
  return false;
};


// --- Уведомления Toast ---
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast align-items-center text-bg-${type} show position-fixed top-0 end-0 m-3`;
  toast.style.zIndex = 9999;
  toast.innerHTML = `
    <div class="d-flex">
      <div class="toast-body">${message}</div>
      <button type="button" class="btn-close me-2 m-auto" onclick="this.parentElement.parentElement.remove()"></button>
    </div>
  `;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

// --- Для роутера/внешнего управления секцией ---
export function showAnnouncementsSection() {
  document.getElementById('page-announcements').style.display = '';
  renderStatusFilters();
  renderRequestList();
}

// --- Важно: не экспортировать/не оставлять лишних плюсов/модалок! ---

window.initAnnouncements = initAnnouncements; // если вызывается из index.html
// При запуске приложения запроси разрешение на уведомления
if (window.requestNotificationPermission) window.requestNotificationPermission();
// --- LIVE PUSH (WebSocket) ---
setupNotifPriming();  // звук станет доступен на первом клике/тапе/клавише где угодно

WebSocketService.on('new_request', (msg) => {
  const data = msg.data || {};
  const me = localStorage.getItem('jm_session_username') || 'user';
  const author = data.last_editor || data.editor || msg.editor || msg.user || '';

  // Обновляем массив (как было у тебя)
  const idx = announcements.findIndex(r => String(r.id) === String(data.id));
  const isNew = idx < 0;
  if (isNew) announcements.push(data); else announcements[idx] = data;

  // 🔊 ЗВУК: только если не автор
  if (author !== me) {
    // если хочешь разделить типы — решай по полям; по умолчанию — как "новая/обновлённая"
    notifyNewRequest(data);
  }

  renderRequestList();
});

// ↓↓↓ НОВОЕ: совместимость, если прилетает add_request
WebSocketService.on('add_request', (msg) => {
  const data = msg.data || {};
  const idx = announcements.findIndex(r => String(r.id) === String(data.id));
  if (idx < 0) announcements.push(data); else announcements[idx] = data;
  renderRequestList();
});

WebSocketService.on('request_updated', (msg) => {
  const data = msg.data || {};
  const me = localStorage.getItem('jm_session_username') || 'user';
  const author = data.last_editor || data.editor || msg.editor || msg.user || '';

  // Твоя логика обновления массива
  const idx = announcements.findIndex(r => String(r.id) === String(data.id));
  if (idx >= 0) announcements[idx] = data;

  // 🔊 ЗВУК: только если не автор
  if (author !== me) {
    notifyEditedRequest(data);
  }

  renderRequestList();
});

let newRequestsCount = 0;

function updateAnnouncementsBadge() {
  const btn = document.getElementById('btn-announcements');
  if (!btn) return;
  btn.querySelector('.notif-badge')?.remove();
  if (newRequestsCount > 0) {
    const badge = document.createElement('span');
    badge.className = 'notif-badge';
    badge.textContent = newRequestsCount > 9 ? '9+' : newRequestsCount;
    badge.style.cssText = `
      position: absolute;
      top: 2px; right: 4px;
      background: #e73333;
      color: #fff;
      border-radius: 10px;
      font-size: 11px;
      padding: 0 5px;
      min-width: 17px;
      text-align: center;
      z-index: 5;
      box-shadow: 0 1px 4px #3334;
      pointer-events: none;
    `;
    btn.style.position = 'relative';
    btn.appendChild(badge);
  }
}


WebSocketService.on('add_comment', (msg) => {
  const req = announcements.find(r => String(r.id) === String(msg.task_id));
  if (!req) return;

  // нормализуем список комментариев
  req.comments = Array.isArray(req.comments)
    ? req.comments.filter(c => c && typeof c === 'object')
    : [];

  // не дублируем один и тот же комментарий
  const exists = req.comments.find(c =>
    c && typeof c === 'object' &&
    c.text === msg.comment?.text &&
    c.user === msg.comment?.user &&
    c.timestamp === msg.comment?.timestamp
  );
  if (!exists) {
    req.comments.push(msg.comment);
  }

  // ЗВУК + СИСТЕМНОЕ УВЕДОМЛЕНИЕ ТОЛЬКО ЕСЛИ коммент не от меня
  const currentUser = localStorage.getItem('jm_session_username');
  const author = msg.comment?.user;
  if (author && author !== currentUser) {
    notifyNewComment(req, msg.comment);
    // если мы НЕ в разделе заявок — увеличиваем бейдж
    if (window.currentSection !== 'announcements') {
      newRequestsCount++;
      updateAnnouncementsBadge();
    }
  }

  renderRequestList();
});


requestNotificationPermission();
// Просто создаём объект аудио — не play!
document.addEventListener("click", function once() {
  primeNotifSound();           // подцагрузили и поставили canPlay = true
  document.removeEventListener("click", once);
});



