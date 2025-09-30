// frontend/js/pages/statuses/index.js
import { WebSocketService } from '../../services/api.js';

// Состояние
let statuses = []; // [{id, request_id, vehicle_number, load_date, status_text, unloaded, unload_date}]
let bound = false;

// Публичный вход
export function showStatusesSection() {
  renderToolbar();
  renderTable();
  bindOnce();

  // Подписываемся на live-обновления от сервера (единожды)
  if (!window.__statuses_on) {
    window.__statuses_on = true;
    WebSocketService.on('statuses_sync', (msg) => {
      const rows = Array.isArray(msg?.data) ? msg.data : [];
      statuses = rows;
      fillTable(statuses);
    });
  }

  // Первоначальный снапшот
  WebSocketService.sendAndWait({ action: 'statuses_sync' }, { want: 'statuses_sync', timeoutMs: 5000 })
    .then((msg) => {
      statuses = Array.isArray(msg?.data) ? msg.data : [];
      fillTable(statuses);
    })
    .catch(() => {
      // Молча, оставим пустую таблицу
    });
}

function renderToolbar() {
  const el = document.getElementById('statuses-filters');
  if (!el) return;
  el.innerHTML = `
    <div class="d-flex align-items-center gap-2 mb-2 flex-wrap">
      <h5 class="m-0">Статусы</h5>
      <span class="text-muted ms-2">(обнуляются ежедневно в 00:00)</span>
    </div>
  `;
}

function renderTable() {
  const wrap = document.getElementById('statuses-content');
  if (!wrap) return;
  wrap.innerHTML = `
    <div class="card">
      <div class="card-body">
        <div class="scroll-box">
          <div class="table-responsive">
            <table class="table stats-table" id="statuses-table">
              <thead>
                <tr>
                  <th class="col-num">№</th>
                  <th class="col-plate">Номер машины</th>
                  <th class="col-load-date">Дата загрузки</th>
                  <th class="col-today">Статус на сегодня</th>
                  <th class="col-unloaded">Выгружено</th>
                  <th class="col-unload-dt">Дата выгрузки</th>
                </tr>
              </thead>
              <tbody id="statuses-tbody"></tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  `;
}

function bindOnce() {
  if (bound) return;
  bound = true;

  const root = document.getElementById('statuses-content');
  if (!root) return;

  // Делегирование кликов по кнопке «Выгружено»
  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-toggle-unloaded]');
    if (!btn) return;

    const rid = Number(btn.dataset.rid);
    const veh = String(btn.dataset.veh || '').trim();
    if (!rid || !veh) return;

    const isOn = btn.classList.contains('btn-success'); // текущее состояние
    const next = !isOn;

    // Найдём соседнее поле даты в этой строке
    const tr = btn.closest('tr');
    let dateInput = tr ? tr.querySelector('input[type="date"][data-unloaddate]') : null;
    let dateVal = dateInput?.value || '';

    if (next && !dateVal) {
      dateVal = todayISO();
      if (dateInput) dateInput.value = dateVal; // оптимистично отрисуем
    }

    WebSocketService.send({
      action: 'statuses_toggle_unloaded',
      request_id: rid,
      vehicle_number: veh,
      unloaded: next,
      unload_date: next ? dateVal : null
    });

    // оптимистично подсветим, сервер всё равно пришлёт statuses_sync
    btn.classList.toggle('btn-success', next);
    btn.classList.toggle('btn-outline-secondary', !next);
    btn.textContent = next ? '✅' : '—';
  });

  // Текст статуса на сегодня (debounce)
  const debouncers = new Map();
  const debounce = (key, fn, ms=400) => {
    if (debouncers.has(key)) clearTimeout(debouncers.get(key));
    const t = setTimeout(fn, ms);
    debouncers.set(key, t);
  };

  root.addEventListener('input', (e) => {
    const input = e.target;
    if (!(input instanceof HTMLInputElement)) return;
    const rid = Number(input.dataset.rid);
    const veh = String(input.dataset.veh || '').trim();

    // поле текстового статуса
    if (input.matches('input[type="text"][data-rid][data-veh]')) {
      const text = input.value || '';
      if (!rid || !veh) return;
      debounce(`text:${rid}:${veh}`, () => {
        WebSocketService.send({
          action: 'statuses_set_text',
          request_id: rid,
          vehicle_number: veh,
          text
        });
      });
    }
  });

  // Изменение даты выгрузки
  root.addEventListener('change', (e) => {
    const input = e.target;
    if (!(input instanceof HTMLInputElement)) return;
    if (!input.matches('input[type="date"][data-unloaddate]')) return;

    const rid = Number(input.dataset.rid);
    const veh = String(input.dataset.veh || '').trim();
    const dateVal = input.value || null;

    if (!rid || !veh) return;

    WebSocketService.send({
      action: 'statuses_toggle_unloaded',
      request_id: rid,
      vehicle_number: veh,
      unloaded: !!dateVal,        // если дата есть — считаем как выгружено
      unload_date: dateVal
    });
  });
}

function fillTable(rows) {
  const tb = document.getElementById('statuses-tbody');
  if (!tb) return;
  tb.innerHTML = '';
  (rows || []).forEach((row, idx) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="text-muted">${idx + 1}</td>
      <td><code>${escapeHtml(row.vehicle_number || '')}</code></td>
      <td>${fmtDate(row.load_date)}</td>
      <td>
        <input type="text" class="form-control form-control-sm" value="${escapeAttr(row.status_text || '')}"
               data-rid="${row.request_id}" data-veh="${escapeAttr(row.vehicle_number || '')}" />
      </td>
      <td class="text-center">
        <button class="btn btn-sm ${row.unloaded ? 'btn-success' : 'btn-outline-secondary'}"
                data-toggle-unloaded data-rid="${row.request_id}" data-veh="${escapeAttr(row.vehicle_number || '')}">
          ${row.unloaded ? '✅' : '—'}
        </button>
      </td>
      <td>
        <input type="date" class="form-control form-control-sm" value="${fmtDateISO(row.unload_date) || ''}"
               data-unloaddate data-rid="${row.request_id}" data-veh="${escapeAttr(row.vehicle_number || '')}" />
      </td>
    `;
    tb.appendChild(tr);
  });
}

/** ===================== УТИЛИТЫ ===================== **/

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const dd = String(d.getDate()).padStart(2,'0');
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const yy = d.getFullYear();
  return `${dd}.${mm}.${yy}`;
}
function fmtDateISO(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const dd = String(d.getDate()).padStart(2,'0');
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const yy = d.getFullYear();
  return `${yy}-${mm}-${dd}`;
}
function todayISO() {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2,'0');
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const yy = d.getFullYear();
  return `${yy}-${mm}-${dd}`;
}
function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;');
}
function escapeAttr(s) {
  return String(s ?? '')
    .replace(/&/g,'&amp;')
    .replace(/"/g,'&quot;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;');
}
