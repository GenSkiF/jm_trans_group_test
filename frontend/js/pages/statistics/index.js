// frontend/js/pages/statistics/index.js

// Уникальное состояние фильтра
let statsCurrentFilter = 'current_loads';

// Локальное хранилище строк для таблицы «Текущие загрузки»
const currentLoadsRows = []; // [{requestId, direction, vehicle, date}]
const savedLoadDates = new Map(); // ключ: requestId__vehicle → первая дата

// Флаг, чтобы не навешивать слушатели повторно
let listenersBound = false;

export function showStatisticsSection() {
  renderStatsFilters();
  renderStatsContent();
  bindOnce();

  // Инициализация из уже загруженных заявок
  try {
    const list = Array.isArray(window.announcements) ? window.announcements : [];
    currentLoadsRows.length = 0;
    for (const req of list) {
      const direction = (req.from && req.to) ? `${req.from} → ${req.to}` : (req.direction || '');
      const drivers = Array.isArray(req.drivers) ? req.drivers : [];
      for (const drv of drivers) {
        const vehicle = drv.carNumber || drv.stateNumber || drv.vehicleNumber || drv.plate || drv.number || drv.tsNumber || '';
        if (!vehicle) continue;

        const whenIso =
          drv.assignedAt || drv.filledAt || drv.driverCardDate ||
          drv.created_at || drv.added_at || '';

        const key = `${req.id || ''}__${String(vehicle).trim()}`;
        // первая «зафиксированная» дата для этой пары заявка__машина
        const firstIso = savedLoadDates.has(key)
          ? savedLoadDates.get(key)
          : (whenIso || '');

        if (firstIso && !savedLoadDates.has(key)) {
          savedLoadDates.set(key, firstIso);
        }

        const nick = drv.addedByNick || drv.added_by_nick || drv.added_by || '';
        currentLoadsRows.push({
          requestId: req.id,
          direction,
          vehicle,
          dateIso: firstIso || null,                 // ISO для сортировки
          date: firstIso ? fmtDate(firstIso) : '',   // видимая дата
          nick
        });
      }
    }
  } catch(e) { console.warn('stats init failed', e); }

  populateCurrentLoads(currentLoadsRows);

}


// Панель кнопок (как в заявках)
function renderStatsFilters() {
  const el = document.getElementById('statistics-filters');
  if (!el) return;

  el.innerHTML = `
    <div class="d-flex align-items-center mb-3 gap-2 flex-wrap" id="stats-panel">
      <div class="ms-3 d-flex gap-1 flex-wrap" id="stats-bar">
        <button class="btn btn-outline-primary" data-filter="current_loads">Текущие загрузки</button>
      </div>
    </div>
  `;

  document.querySelectorAll('#stats-bar button').forEach(btn => {
    const f = btn.getAttribute('data-filter');
    btn.onclick = () => setStatsFilter(f);
    btn.classList.toggle('active', f === statsCurrentFilter);
  });
}

function setStatsFilter(filter) {
  if (statsCurrentFilter === filter) return;
  statsCurrentFilter = filter;
  renderStatsFilters();
  renderStatsContent();
  if (statsCurrentFilter === 'current_loads') {
    populateCurrentLoads(currentLoadsRows);
  }
}

/** ===================== ДАННЫЕ / ЗАПОЛНЕНИЕ ===================== **/

// Добавить/обновить строку в таблице (по requestId+vehicle)
function upsertCurrentLoad(entry) {
  const keyOf = (v) => `${v.requestId || ''}__${(v.vehicle || '').trim()}`;
  const k = keyOf(entry);
  const idx = currentLoadsRows.findIndex(x => keyOf(x) === k);

  // Принимаем dateIso (предпочтительно). Если пришла только date — тоже примем.
  const incomingIso = entry.dateIso || entry.date || '';
  let firstIso = '';

  if (incomingIso) {
    firstIso = String(incomingIso);
  } else if (idx >= 0 && currentLoadsRows[idx].dateIso) {
    firstIso = currentLoadsRows[idx].dateIso;
  } else if (savedLoadDates.has(k)) {
    firstIso = savedLoadDates.get(k);
  } else {
    firstIso = '';
  }

  if (firstIso && !savedLoadDates.has(k)) {
    savedLoadDates.set(k, firstIso);
  }

  const next = {
    requestId: entry.requestId,
    direction: entry.direction,
    vehicle: (entry.vehicle || '').trim(),
    dateIso: firstIso || null,
    date: firstIso ? fmtDate(firstIso) : '',
    nick: entry.nick || ''
  };

  if (idx >= 0) {
    currentLoadsRows[idx] = next;
  } else {
    currentLoadsRows.push(next);
  }

  if (statsCurrentFilter === 'current_loads') {
    populateCurrentLoads(currentLoadsRows);
  }
}


// Публичная функция для подстановки строк (оставляем на будущее)
export function populateCurrentLoads(rows) {
  const tbody = document.getElementById('stats-current-loads-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  // Сортировка по убыванию времени: новые записи сверху
  const ts = (v) => {
    if (!v) return 0;
    const t = Date.parse(v);
    if (!Number.isNaN(t)) return t;
    // запасной парсер для "ДД.ММ.ГГГГ"
    const m = String(v).match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    if (m) {
      const d = new Date(`${m[3]}-${m[2]}-${m[1]}T00:00:00Z`);
      return d.getTime() || 0;
    }
    return 0;
  };

  const sorted = [...(rows || [])].sort((a, b) =>
    ts(b.dateIso || b.date) - ts(a.dateIso || a.date)
  );

  sorted.forEach((row, idx) => {
    const tr = document.createElement('tr');

    const direction = row.direction ?? '';
    const vehicle   = row.vehicle ?? '';
    const date      = row.date ?? '';
    const nick      = row.nick ?? '';

    tr.innerHTML = `
      <td class="col-idx">${idx + 1}</td>
      <td class="col-direction">${escapeHtml(direction)}</td>
      <td class="col-vehicle">${escapeHtml(vehicle)}</td>
      <td class="col-date">${escapeHtml(date)}</td>
      <td class="col-nick">${escapeHtml(nick)}</td>
    `;
    tbody.appendChild(tr);
  });
}


// Один раз навесим слушатели на глобальные события
function bindOnce() {
  if (listenersBound) return;

  // 1) Событие от UI после успешного добавления водителя
  window.addEventListener('driver:assigned', (e) => {
    const d = e.detail || {};
    const direction = calcDirection(d.request || d);
    const vehicle   = pickVehicleNumber(d.driver || d);
    const whenIso   = d.date || d.assignedAt || new Date().toISOString();

    if (!vehicle) return;
    const nick = d.nick || d.editor || (localStorage.getItem('jm_session_username') || '');
    upsertCurrentLoad({
      requestId: d.requestId || (d.request && d.request.id) || '',
      direction,
      vehicle,
      dateIso: whenIso, // передаём ISO внутрь
      nick
    });
  });

  // 2) События, приходящие с сервера по WebSocket (переэмитированы в api.js)
  window.addEventListener('ws:driver_assigned', (e) => {
    const d = e.detail || {};
    const direction = calcDirection(d.request || d);
    const vehicle   = pickVehicleNumber(d.driver || d);
    const whenIso   = d.date || d.assignedAt || d.updated_at || d.created_at || null;

    if (!vehicle) return;
    upsertCurrentLoad({
      requestId: d.requestId || (d.request && d.request.id) || '',
      direction,
      vehicle,
      dateIso: whenIso || undefined // ISO, без форматирования
    });
  });


  // 3) Обновление из актуального announcements (когда пришёл PUSH)
  window.addEventListener('ann:request_updated', () => {
    try {
      const list = Array.isArray(window.announcements) ? window.announcements : [];
      currentLoadsRows.length = 0;

      for (const req of list) {
        const direction = (req.from && req.to) ? `${req.from} → ${req.to}` : (req.direction || '');
        const drivers = Array.isArray(req.drivers) ? req.drivers : [];
        for (const drv of drivers) {
          const vehicle = drv.carNumber || drv.stateNumber || drv.vehicleNumber || drv.plate || drv.number || drv.tsNumber || '';
          if (!vehicle) continue;

          const whenIso =
            drv.assignedAt || drv.filledAt || drv.driverCardDate ||
            drv.created_at || drv.added_at || '';

          const key = `${req.id || ''}__${String(vehicle).trim()}`;
          const firstIso = savedLoadDates.has(key)
            ? savedLoadDates.get(key)
            : (whenIso || '');

          if (firstIso && !savedLoadDates.has(key)) {
            savedLoadDates.set(key, firstIso);
          }

          const nick = drv.addedByNick || drv.added_by_nick || drv.added_by || '';
          currentLoadsRows.push({
            requestId: req.id,
            direction,
            vehicle,
            dateIso: firstIso || null,
            date: firstIso ? fmtDate(firstIso) : '',
            nick
          });
        }
      }

      if (statsCurrentFilter === 'current_loads') {
        populateCurrentLoads(currentLoadsRows); // внутри уже сортировка
      }
    } catch(e) {
      console.warn('stats rebuild failed', e);
    }
  });



  listenersBound = true;
}

/** ===================== РЕНДЕР КОНТЕНТА ===================== **/

function renderStatsContent() {
  const wrap = document.getElementById('statistics-content');
  if (!wrap) return;

  if (statsCurrentFilter === 'current_loads') {
    wrap.innerHTML = `
      <div class="card">
        <div class="card-body">
          <h5 class="card-title mb-3">Текущие загрузки</h5>
          <div class="scroll-box">
            <div class="table-responsive">
              <table class="table stats-table" id="stats-current-loads-table">
                <thead>
                  <tr>
                    <th class="col-idx">№</th>
                    <th class="col-direction">Направление</th>
                    <th class="col-vehicle">данные ТС</th>
                    <th class="col-date">Дата</th>
                    <th class="col-nick">Ник</th>
                  </tr>
                </thead>
                <tbody id="stats-current-loads-tbody"></tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    `;
  } else {
    wrap.innerHTML = `<div class="alert alert-info">Выберите раздел статистики.</div>`;
  }
}

/** ===================== УТИЛИТЫ ===================== **/

// Берем направление из заявки (поддерживаем разные названия полей)
function calcDirection(req) {
  if (!req) return '';
  const from = req.fromCity || req.from || req.loading || req.origin || req.source || req.routeFrom || '';
  const to   = req.toCity   || req.to   || req.destination || req.target || req.routeTo   || '';
  if (from && to) return `${from}—${to}`;
  return req.direction || req.route || '';
}

// Вытаскиваем номер ТС из объекта водителя/ТС
function pickVehicleNumber(src) {
  if (!src) return '';
  return (
    src.stateNumber ||
    src.vehicleNumber ||
    src.plate ||
    src.carNumber ||
    src.number ||
    src.tsNumber ||
    ''
  );
}

// Формат: ДД.ММ.ГГГГ
function fmtDate(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

// Безопасный вывод
function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
