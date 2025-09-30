// Открыть форму для новой заявки
// plus.js
import { WebSocketService } from './services/api.js'; // путь может быть '../services/api.js'
import { attachUniversalSearch } from './services/universal-search.js';
import { renderFlagSpan, applyFlagIcon } from "./components/flag-icon.js";

export function plusAnnouncements() {
  // Удаляем предыдущее окно, если есть
  const old = document.getElementById('plus-modal');
  if (old) old.remove();

  // Вспомогательные переменные
  let dateInputs = [];
  let readyCheckboxState = false;

  // Основная форма
  let modal = document.createElement('div');
  modal.id = 'plus-modal';
  modal.style = `
    position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:10000;
    background:rgba(0,0,0,0.18);display:flex;align-items:center;justify-content:center;
  `;

  // HTML формы
  modal.innerHTML = `
    <div style="background:#fff;max-width:540px;width:98vw;max-height:90vh;overflow:auto;padding:24px 22px 16px 22px;border-radius:13px;box-shadow:0 2px 24px #b0c2e9;">
      <h4 class="mb-3">ახალი განაცხადი</h4>
      <form id="plus-form">
        <div class="mb-2">
          <label>საიდან</label>
          <div class="position-relative">
            <input class="form-control ps-5" id="plus-from" required>
            <span id="plus-from-flag" class="fi" style="position:absolute;left:12px;top:50%;transform:translateY(-50%);display:none"></span>
          </div>
        </div>

        <div class="mb-2">
          <label>სად</label>
          <div class="position-relative">
            <input class="form-control ps-5" id="plus-to" required>
            <span id="plus-to-flag" class="fi" style="position:absolute;left:12px;top:50%;transform:translateY(-50%);display:none"></span>
          </div>
        </div>
        <div class="mb-2"><label>ტვირთი</label>
          <input class="form-control" id="plus-cargo"></div>
        <div class="mb-2"><label>ტრანსპორტი</label>
          <select class="form-select" id="plus-transport" required>
            <option value="">აირჩიეთ</option>
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
        <div class="mb-2" id="ref-mode-row" style="display:none">
          <label>რეჟიმი</label>
          <select class="form-select" id="plus-mode">
            <option>რეჟიმით</option>
            <option>რეჟიმის გარეშე</option>
          </select>
        </div>
        <div class="mb-2" id="temp-row" style="display:none">
          <label>ტემპერატურა</label>
          <input class="form-control" id="plus-temp" placeholder="ტემპერატურა (თუ საჭიროა)">
        </div>
        <div class="mb-2">
          <label>დატვირთვის თარიღების რაოდენობა</label>
          <input type="number" min="1" value="1" class="form-control" id="plus-date-count">
        </div>
        <div class="form-check mb-2">
          <input class="form-check-input" type="checkbox" id="plus-ready">
          <label class="form-check-label" for="plus-ready">ტვირთი უკვე მზადაა</label>
        </div>
        <div class="mb-2" id="truck-ready-row" style="display:none">
          <label>მანქანების რაოდენობა</label>
          <input class="form-control" id="plus-truck-ready" type="number" min="1" value="1">
        </div>
        <div id="date-fields" class="mb-2"></div>
        <div class="mb-2"><label>წონა (ტ)</label>
          <input class="form-control" id="plus-weight" type="number" min="0"></div>
        <div class="mb-2"><label>ფასი</label>
          <input class="form-control" id="plus-price" type="text"></div>
        <div class="mb-2"><label>შენიშვნა</label>
          <textarea class="form-control" id="plus-note" rows="2"></textarea></div>
        <div class="d-flex justify-content-end gap-2 mt-3">
          <button type="submit" class="btn btn-primary">შენახვა</button>
          <button type="button" class="btn btn-outline-secondary" id="plus-cancel-btn">გაუქმება</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(modal);
  // --- Автокомплит + флажки для "Откуда/Куда"
  const fromInput = modal.querySelector('#plus-from');
  const toInput   = modal.querySelector('#plus-to');
  const fromFlag  = modal.querySelector('#plus-from-flag');
  const toFlag    = modal.querySelector('#plus-to-flag');

  let fromCountry = "";
  let toCountry   = "";

  attachUniversalSearch(fromInput, {
    endpoint: 'nominatim',
    onSelect: ({ label, country_code }) => {
      fromInput.value = label || fromInput.value;
      fromCountry = (country_code || "").toUpperCase();
      applyFlagIcon(fromFlag, fromCountry);
    }
  });
  attachUniversalSearch(toInput, {
    endpoint: 'nominatim',
    onSelect: ({ label, country_code }) => {
      toInput.value = label || toInput.value;
      toCountry = (country_code || "").toUpperCase();
      applyFlagIcon(toFlag, toCountry);
    }
  });

  fromInput.addEventListener('input', () => { if (!fromInput.value.trim()) applyFlagIcon(fromFlag, ""); });
  toInput  .addEventListener('input', () => { if (!toInput.value.trim())   applyFlagIcon(toFlag,   ""); });


  // --- Динамическое управление полями ---

  // refs
  const transportSelect = modal.querySelector('#plus-transport');
  const refModeRow = modal.querySelector('#ref-mode-row');
  const refModeSelect = modal.querySelector('#plus-mode');
  const tempRow = modal.querySelector('#temp-row');
  const dateCountInput = modal.querySelector('#plus-date-count');
  const readyCheckbox = modal.querySelector('#plus-ready');
  const dateFieldsDiv = modal.querySelector('#date-fields');
  const truckReadyRow = modal.querySelector('#truck-ready-row');
  const truckReadyInput = modal.querySelector('#plus-truck-ready');

  // смена транспорта
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

  // смена режима
  refModeSelect.addEventListener('change', () => {
    if (refModeSelect.value === 'რეჟიმით') tempRow.style.display = '';
    else tempRow.style.display = 'none';
  });

  // чекбокс "готов"
  readyCheckbox.addEventListener('change', () => {
    readyCheckboxState = readyCheckbox.checked;
    updateDateFields();
  });

  // изменение количества дат
  dateCountInput.addEventListener('input', updateDateFields);

  // функция динамического рендера дат
  function updateDateFields() {
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
          <input type="number" class="form-control" style="max-width:120px" min="1" value="1" placeholder="მანქანების რაოდენობა" required>
        `;
        dateFieldsDiv.appendChild(row);
        dateInputs.push(row);
      }
    }
  }
  updateDateFields();

  // --- Сохранение/отмена ---
  modal.querySelector('#plus-cancel-btn').onclick = closePlusModal;

  modal.querySelector('#plus-form').onsubmit = function(e) {
    e.preventDefault();

    // --- Проверка обязательных полей ---
    let errors = [];
    const from = modal.querySelector('#plus-from').value.trim();
    const to = modal.querySelector('#plus-to').value.trim();
    const transport = transportSelect.value;
    const dateCount = parseInt(dateCountInput.value);
    const truckReadyVal = parseInt(truckReadyInput.value);

    if (!from) errors.push("საიდან");
    if (!to) errors.push("სად");
    if (!transport) errors.push("ტრანსპორტი");
    if (!readyCheckbox.checked && (!dateCount || dateCount < 1)) errors.push("დატვირთვის თარიღების რაოდენობა");
    if (readyCheckbox.checked && (!truckReadyVal || truckReadyVal < 1)) errors.push("მანქანების რაოდენობა");

    // проверка дат и машин
    if (!readyCheckbox.checked) {
      let allDates = [];
      for (let row of dateInputs) {
        const date = row.querySelector('input[type="date"]').value;
        const trucks = row.querySelector('input[type="number"]').value;
        if (!date) errors.push("დატვირთვის თარიღი");
        if (!trucks || trucks < 1) errors.push("მანქანების რაოდენობა");
        allDates.push(date);
      }
      // Проверка на уникальность дат
      if (new Set(allDates).size !== allDates.length) {
        alert("ორი ერთნაირი თარიღის შეყვანა დაუშვებელია!");
        return;
      }
    }

    if (errors.length) {
      alert("ყველა სავალდებულო ველი უნდა იყოს შევსებული:\n" + errors.join("\n"));
      return;
    }

    // --- Собираем данные заявки ---
    let data = {
      from,
      to,
      from_country: fromCountry || "",
      to_country: toCountry || "",
      cargo: modal.querySelector('#plus-cargo').value.trim(),
      transport,
      mode: (transport === "რეფი" ? refModeSelect.value : ""),
      temperature: (transport === "რეფი" && refModeSelect.value === "რეჟიმით") ? modal.querySelector('#plus-temp').value.trim() : "",
      loading_dates: [],
      weight: modal.querySelector('#plus-weight').value,
      note: modal.querySelector('#plus-note').value,
      price: modal.querySelector('#plus-price').value,
      ready: readyCheckbox.checked,
      status: "active",
      timestamp: new Date().toISOString().slice(0, 19).replace('T', ' '),
      user: localStorage.getItem('jm_session_username') || 'user'   // ← вот эта строка!
    };

    // Даты погрузки и количество машин
    if (readyCheckbox.checked) {
      // только 1 дата и количество
      let today = new Date().toISOString().slice(0,10);
      data.loading_dates = [{
        date: today,
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

    // --- здесь отправь data на сервер через WebSocket или куда надо ---
    WebSocketService.sendAndWait({
      action: "add_request",
      data
    }).then(resp => {
      // если сервер вернул объект заявки — берём его, иначе используем локальные данные
      const created = resp?.data || data;
      WebSocketService.emit('new_request', { action: 'new_request', data: created });
      closePlusModal();
    }).catch(err => {
      // даже если сервер не ответил — покажем заявку локально, чтобы автор её увидел сразу
      WebSocketService.emit('new_request', { action: 'new_request', data });
      alert("Ошибка отправки: " + err.message);
    });

  };

  function closePlusModal() {
    document.body.removeChild(modal);
  }
}


// Открыть форму для нового транспорта
export function plusTransport() {
  alert("Добавление транспорта — скоро будет реализовано!");
}

// Открыть форму для логистики
export function plusLogistics() {
  alert("Добавление логистики — скоро будет реализовано!");
}

// ...добавляй новые по мере необходимости