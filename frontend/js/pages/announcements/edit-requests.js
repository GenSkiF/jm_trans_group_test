// edit-requests.js
import { WebSocketService } from '../../services/api.js';
import { attachUniversalSearch } from '../../services/universal-search.js';
import { applyFlagIcon } from '../../components/flag-icon.js';

const announcements = window.announcements;
const renderRequestList = window.renderRequestList;

export function openEditRequestModal(existing) {
  // Удаляем предыдущее окно, если есть
  const old = document.getElementById('edit-request-modal');
  if (old) old.remove();

  let modal = document.createElement('div');
  modal.id = 'edit-request-modal';
  modal.style = `
    position: fixed; left:0; top:0; width:100vw; height:100vh; z-index:10000;
    background: rgba(0,0,0,0.18); display:flex; align-items:center; justify-content:center;
  `;

  modal.innerHTML = `
    <div style="background:#fff; max-width:540px; width:98vw; max-height:90vh; overflow:auto; padding:24px 22px 16px 22px; border-radius:13px; box-shadow:0 2px 24px #b0c2e9;">
      <h4 class="mb-3">Редактировать заявку</h4>
      <form id="edit-request-form">
        <div class="mb-2">
          <label>Откуда</label>
          <div class="position-relative">
            <input class="form-control ps-5" id="edit-from" required>
            <span id="edit-from-flag" class="fi" style="position:absolute;left:12px;top:50%;transform:translateY(-50%);display:none"></span>
          </div>
        </div>
        <div class="mb-2">
          <label>Куда</label>
          <div class="position-relative">
            <input class="form-control ps-5" id="edit-to" required>
            <span id="edit-to-flag" class="fi" style="position:absolute;left:12px;top:50%;transform:translateY(-50%);display:none"></span>
          </div>
        </div>
        <div class="mb-2"><label>Груз</label><input class="form-control" id="edit-cargo"></div>
        <div class="mb-2"><label>Транспорт</label>
          <select class="form-select" id="edit-transport" required>
            <option value="">Выберите</option>
            <option>ტენტი</option>
            <option>რეფი</option>
            <option>რეფი/ტენტი</option>
            <option>კონტეინერი</option>
            <option>ფურშეტა</option>
            <option>იზოთერმული</option>
            <option>ცისტერნა</option>
            <option>სხვა</option>
          </select>
        </div>
        <!-- Добавь остальные поля как в plus.js -->
        <div class="mb-2" id="ref-mode-row" style="display:none">
          <label>Режим</label>
          <select class="form-select" id="edit-mode">
            <option>რეჟიმით</option>
            <option>რეჟიმის გარეშე</option>
          </select>
        </div>
        <div class="mb-2" id="temp-row" style="display:none">
          <label>Температура</label>
          <input class="form-control" id="edit-temp" placeholder="Температура (если нужно)">
        </div>
        <div class="mb-2">
          <label>Количество дат погрузки</label>
          <input type="number" min="1" value="1" class="form-control" id="edit-date-count">
        </div>
        <div class="form-check mb-2">
          <input class="form-check-input" type="checkbox" id="edit-ready">
          <label class="form-check-label" for="edit-ready">Груз уже готов</label>
        </div>
        <div class="mb-2" id="truck-ready-row" style="display:none">
          <label>Дата (если груз уже готов):</label>
          <input class="form-control" id="edit-truck-ready-date" type="date">
          <label>Количество машин</label>
          <input class="form-control" id="edit-truck-ready" type="number" min="1" value="1">
        </div>

        <div id="edit-date-fields" class="mb-2"></div>
        <div class="mb-2"><label>Вес (ტ.)</label><input class="form-control" id="edit-weight" type="number" min="0"></div>
        <div class="mb-2"><label>Цена</label><input class="form-control" id="edit-price" type="text"></div>
        <div class="mb-2"><label>Примечание</label><textarea class="form-control" id="edit-note" rows="2"></textarea></div>
        <div class="d-flex justify-content-end gap-2 mt-3">
          <button type="submit" class="btn btn-primary">Сохранить</button>
          <button type="button" class="btn btn-outline-secondary" id="edit-cancel-btn">Отмена</button>
        </div>
      </form>
    </div>
  `;

  document.body.appendChild(modal);
  const editFromInput = modal.querySelector('#edit-from');
  const editToInput   = modal.querySelector('#edit-to');
  const editFromFlag  = modal.querySelector('#edit-from-flag');
  const editToFlag    = modal.querySelector('#edit-to-flag');

  let editFromCountry = (existing.from_country || "").toUpperCase();
  let editToCountry   = (existing.to_country   || "").toUpperCase();

  applyFlagIcon(editFromFlag, editFromCountry);
  applyFlagIcon(editToFlag,   editToCountry);

  attachUniversalSearch(editFromInput, {
    endpoint: 'nominatim',
    onSelect: ({ label, country_code }) => {
      editFromInput.value = label || editFromInput.value;
      editFromCountry = (country_code || "").toUpperCase();
      applyFlagIcon(editFromFlag, editFromCountry);
    }
  });
  attachUniversalSearch(editToInput, {
    endpoint: 'nominatim',
    onSelect: ({ label, country_code }) => {
      editToInput.value = label || editToInput.value;
      editToCountry = (country_code || "").toUpperCase();
      applyFlagIcon(editToFlag, editToCountry);
    }
  });

  editFromInput.addEventListener('input', () => { if (!editFromInput.value.trim()) applyFlagIcon(editFromFlag, ""); });
  editToInput  .addEventListener('input', () => { if (!editToInput.value.trim())   applyFlagIcon(editToFlag,   ""); });



  // Заполнение формы из existing
  const transportSelect = modal.querySelector('#edit-transport');
  const refModeRow = modal.querySelector('#ref-mode-row');
  const refModeSelect = modal.querySelector('#edit-mode');
  const tempRow = modal.querySelector('#temp-row');
  const dateCountInput = modal.querySelector('#edit-date-count');
  const readyCheckbox = modal.querySelector('#edit-ready');
  const dateFieldsDiv = modal.querySelector('#edit-date-fields');
  const truckReadyRow = modal.querySelector('#truck-ready-row');
  const truckReadyInput = modal.querySelector('#edit-truck-ready');
  let dateInputs = [];

  function updateDateFields() {
    // 1. Сохраняем предыдущие значения дат и количества машин
    const oldValues = dateInputs.map(row => ({
      date: row.querySelector('input[type="date"]')?.value || '',
      truck_count: row.querySelector('input[type="number"]')?.value || ''
    }));

    dateFieldsDiv.innerHTML = '';
    dateInputs = [];

    if (readyCheckbox.checked) {
      dateCountInput.disabled = true;
      dateFieldsDiv.style.display = 'none';
      truckReadyRow.style.display = '';
    } else {
      dateCountInput.disabled = false;
      dateFieldsDiv.style.display = '';
      truckReadyRow.style.display = 'none';
      let count = Math.max(1, parseInt(dateCountInput.value) || 1);
      for (let i = 0; i < count; i++) {
        let row = document.createElement('div');
        row.className = 'd-flex align-items-center mb-1 gap-2';
        row.innerHTML = `
          <input type="date" class="form-control" style="max-width:140px" required>
          <input type="number" class="form-control" style="max-width:120px" min="1" value="1" placeholder="Количество машин" required>
        `;
        // Переносим значения, если есть
        if (oldValues[i]) {
          row.querySelector('input[type="date"]').value = oldValues[i].date;
          row.querySelector('input[type="number"]').value = oldValues[i].truck_count;
        }
        dateFieldsDiv.appendChild(row);
        dateInputs.push(row);
      }
    }
  }


  // Инициализация значений
  transportSelect.value = existing.transport || '';
  refModeSelect.value = existing.mode || 'რეჟიმით';
  modal.querySelector('#edit-from').value = existing.from || '';
  modal.querySelector('#edit-to').value = existing.to || '';
  modal.querySelector('#edit-cargo').value = existing.cargo || '';
  modal.querySelector('#edit-temp').value = existing.temperature || '';
  modal.querySelector('#edit-weight').value = existing.weight || '';
  modal.querySelector('#edit-note').value = existing.note || '';
  modal.querySelector('#edit-price').value = existing.price || '';
  readyCheckbox.checked = !!existing.ready;

  
  // Если есть даты загрузки — выставляем корректное количество полей
  if (Array.isArray(existing.loading_dates) && existing.loading_dates.length > 0) {
    dateCountInput.value = existing.loading_dates.length;
  } else {
    dateCountInput.value = 1;
  }
  updateDateFields();


  // Заполнить даты из existing.loading_dates
  if (Array.isArray(existing.loading_dates)) {
    existing.loading_dates.forEach((ld, i) => {
      if (dateInputs[i]) {
        dateInputs[i].querySelector('input[type="date"]').value = ld.date || '';
        dateInputs[i].querySelector('input[type="number"]').value = ld.truck_count || 1;
      }
    });
  }

  if (existing.ready) {
    truckReadyRow.style.display = '';
    truckReadyInput.value = existing.loading_dates?.[0]?.truck_count || 1;
    let readyDateInput = modal.querySelector('#edit-truck-ready-date');
    if (readyDateInput) {
      readyDateInput.value = existing.loading_dates?.[0]?.date || new Date().toISOString().slice(0,10);
      readyDateInput.min = new Date().toISOString().slice(0,10);
      // Если дата не выбрана — подставить today
      if (!readyDateInput.value) {
        readyDateInput.value = new Date().toISOString().slice(0,10);
      }
    }
  }


  transportSelect.addEventListener('change', () => {
    if (transportSelect.value === 'რეფი') {
      refModeRow.style.display = '';
      if (refModeSelect.value === 'რეჟიმით') tempRow.style.display = '';
      else tempRow.style.display = 'none';
    } else {
      refModeRow.style.display = 'none';
      tempRow.style.display = 'none';
    }
  });

  refModeSelect.addEventListener('change', () => {
    if (refModeSelect.value === 'რეჟიმით') tempRow.style.display = '';
    else tempRow.style.display = 'none';
  });

  readyCheckbox.addEventListener('change', () => {
    updateDateFields();
  });

  dateCountInput.addEventListener('input', updateDateFields);

  // Сохранение
  modal.querySelector('#edit-cancel-btn').onclick = () => modal.remove();

  modal.querySelector('#edit-request-form').onsubmit = async (e) => {
    e.preventDefault();

    // Собираем данные из формы
    let data = {
      from: modal.querySelector('#edit-from').value.trim(),
      to: modal.querySelector('#edit-to').value.trim(),
      from_country: editFromCountry || "",
      to_country:   editToCountry   || "",
      cargo: modal.querySelector('#edit-cargo').value.trim(),
      transport: transportSelect.value,
      mode: (transportSelect.value === "რეფი" ? refModeSelect.value : ""),
      temperature: (transportSelect.value === "რეფი" && refModeSelect.value === "რეჟიმით") ? modal.querySelector('#edit-temp').value.trim() : "",
      loading_dates: [],
      weight: modal.querySelector('#edit-weight').value,
      note: modal.querySelector('#edit-note').value,
      price: modal.querySelector('#edit-price').value,
      ready: readyCheckbox.checked,
      status: existing.status || "active",
      user: existing.user,
      timestamp: existing.timestamp || new Date().toISOString().slice(0, 19).replace('T', ' ')
    };

    if (readyCheckbox.checked) {
      // Получить выбранную дату (если есть)
      let readyDate = truckReadyRow.querySelector('input[type="date"]');
      data.loading_dates = [{
        date: readyDate ? readyDate.value : new Date().toISOString().slice(0, 10),
        truck_count: truckReadyInput.value
      }];
    } else {
      for (let row of dateInputs) {
        data.loading_dates.push({
          date: row.querySelector('input[type="date"]').value,
          truck_count: row.querySelector('input[type="number"]').value
        });
      }
    }

    // Одноразовая подписка на server push именно по этой заявке
    let gotServerUpdate = false;
    const offOnce = addOnceWsCallback('request_updated', (msg) => {
      try {
        const updated = msg?.data || msg; // на всякий случай
        const updatedId = Number(updated?.id ?? updated?.request_id);
        if (updatedId === Number(existing.id)) {
          gotServerUpdate = true;
          try { modal.remove(); } catch {}
          offOnce(); // отписываемся
        }
      } catch {}
    });

    try {
      await WebSocketService.sendAndWait({
        action: "edit_request",
        id: existing.id,
        editor: localStorage.getItem('jm_session_username') || 'user',
        data
      });

      // Если серверский push ещё не пришёл — эмулируем через общий эмиттер
      if (!gotServerUpdate) {
        WebSocketService.emit('request_updated', {
          action: 'request_updated',
          data: {
            ...existing,
            ...data,
            id: existing.id,
            last_editor: localStorage.getItem('jm_session_username') || 'user',
            last_edit_ts: new Date().toISOString().slice(0,19).replace('T',' ')
          }
        });
      }

      // Закрыть модалку, если ещё не закрыта
      try { modal.remove(); } catch {}
    } catch (e) {
      // Если обновление всё же приехало push'ем — ошибок не показываем
      if (!gotServerUpdate) {
        alert('Ошибка сохранения заявки: ' + (e?.message || e));
      } else {
        console.warn('edit_request: обновление получено push-ом, но sendAndWait вернул ошибку/таймаут:', e);
      }
    } finally {
      try { offOnce(); } catch {}
    }

    /* Вспомогательная одноразовая подписка на callbacks */
    function addOnceWsCallback(name, fn) {
      const off = WebSocketService.on(name, (payload) => {
        try { fn(payload); } finally { off(); }
      });
      return off;
    }

  };
}
