// drivers_card.js
import { WebSocketService } from '../../services/api.js';

// Безопасный локальный эмит (не меняет работы реального PUSH)
function safeEmitNewRequest(data, { silent = true } = {}) {
  try {
    WebSocketService.emit('new_request', {
      action: 'new_request',
      data,
      __local: true,
      __silent: !!silent
    });
  } catch (e) {
    console.error('safeEmitNewRequest error:', e);
  }
}

function emitLocal(event, payload) {
  try {
    WebSocketService.emit(String(event), payload);
  } catch (e) {
    console.error('emitLocal error:', e);
  }
}



// Водители секция для карточки заявки
export function renderDriversSection(req) {
  const remaining = req.ready
  ? Number(req.loading_dates?.[0]?.truck_count || 0)
  : (Array.isArray(req.loading_dates) ? req.loading_dates.reduce((s, x) => s + Number(x.truck_count || 0), 0) : 0);
  return `
    <div class="d-flex align-items-center mb-1">
      <b class="drivers-title" data-id="${req.id}" style="cursor:pointer">🚚 Водители:</b>
      <button
        class="btn btn-outline-primary btn-sm ms-2"
        id="add-driver-btn-${req.id}"
        title="${remaining > 0 ? 'Добавить водителя' : 'Мест нет'}"
        ${remaining > 0 ? '' : 'disabled'}
      >➕</button>
    </div>
    <div class="drivers-scroll">
      ${
        Array.isArray(req.drivers) && req.drivers.length > 0
          ? req.drivers.map((d, i)=> `
              <div class="driver-card shadow-sm border rounded p-2 mb-2" style="background:#f9fbff; position:relative;"
                data-driver-idx="${i}"
                data-request-id="${req.id}">
                <div class="d-flex align-items-center justify-content-between mb-1">
                  <span>
                    <b>${d.name || '-'} ${d.surname || ''}</b>
                    <span class="text-secondary ms-2">(${d.carNumber || ''})</span>
                  </span>
                  <span class="text-muted" style="white-space:nowrap; min-width: 80px; text-align:right; font-size:93%;">
                    ${d.date ? formatDateShort(d.date) : ''}
                  </span>
                </div>
                <div class="driver-files-list d-flex flex-wrap gap-2">
                  ${Array.isArray(d.files) && d.files.length > 0
                    ? d.files.map(file => renderDriverFile(file, req.id, d)).join('')
                    : '<span class="text-secondary">Нет файлов</span>'
                  }
                </div>
              </div>
            `).join('')
          : '<i>Нет водителей</i>'
      }
    </div>
  `;
}

// Короткий формат даты (только дата без времени)
function formatDateShort(dt) {
  if (!dt) return '-';
  try {
    let d = dt.split(/[T ]/)[0].split('-');
    if (d.length === 3) return `${d[2]}.${d[1]}.${d[0]}`;
    return dt;
  } catch { return dt; }
}

// Файл — отдельный блок, позже сделаешь на него onClick (скачать, отправить и т.д.)
function renderDriverFile(file, requestId, driver) {
  if (file && (file.name || typeof file === 'string')) {
    const fname = file.name || file;
    // Кнопка для скачивания файла через WebSocket (task_id = requestId)
    return `<button class="btn btn-sm btn-link px-1 py-0 driver-download-btn"
                   data-task-id="${requestId}" data-filename="${fname}">
              ⬇️ ${fname}
            </button>`;
  }
  return `<span class="btn btn-sm btn-light px-1 py-0" style="pointer-events:none;">${file.name || file}</span>`;
}



// === 1. Загрузка файла на сервер через WebSocket, возвращает {name, url} или {name}
async function uploadDriverFileWS(file, requestId) {
  // ... (чтение base64)
  const base64 = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  // Отправляем файл по WS (action: 'upload_file')
  const resp = await WebSocketService.sendAndWait({
    action: 'upload_file',
    request_id: requestId,
    file_type: 'driver_file',
    filename: file.name,
    content_base64: base64
  });
  // Смотри что возвращает сервер:
  console.log('Ответ сервера на upload_file:', resp);

  if (resp.status !== 'ok') {
    console.error('Ошибка загрузки файла:', resp);
    throw new Error(resp.error || JSON.stringify(resp));
  }
  return resp.file || {name: file.name};
}

// === В самом начале или после импортов ===
export async function downloadDriverFile(task_id, filename) {
  try {
    const resp = await WebSocketService.sendAndWait({
      action: "download_file",
      task_id: task_id,
      filename: filename
    });
    if (!resp.filedata) { alert("Файл не найден или ошибка на сервере!"); return; }
    // base64 → Blob → download
    const bstr = atob(resp.filedata);
    const u8arr = new Uint8Array(bstr.length);
    for (let i = 0; i < bstr.length; ++i) u8arr[i] = bstr.charCodeAt(i);
    const blob = new Blob([u8arr]);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (e) { alert("Ошибка скачивания файла: " + e.message); }
}


export function handleDriverMenuAction(requestId) {
  // Удаляем предыдущий модал, если был
  document.getElementById('add-driver-modal')?.remove();

  // --- НАХОДИМ заявку по id ---
  const announcements = window.announcements;
  const request = announcements.find(r => String(r.id) === String(requestId));
  if (!request) return;

  // --- Проверяем доступно ли хоть одно место ---
  let available = false;
  if (request.ready) {
    // В "Груз готов" truck_count уже означает ОСТАТОК мест.
    // Значит просто проверяем, что остаток > 0.
    const cntLeft = Number(request.loading_dates?.[0]?.truck_count || 0);
    available = cntLeft > 0;
  } else {
    // Для обычных дат — есть ли дата с остатком > 0
    available = (request.loading_dates || []).some(ld => Number(ld.truck_count || 0) > 0);
  }


  // Если нет свободных мест — сразу алерт и return:
  if (!available) {
    alert("Все машины для этой заявки уже распределены! Добавить ещё водителя невозможно.");
    return;
  }


  // Модальное окно
  const modal = document.createElement('div');
  modal.id = 'add-driver-modal';
  modal.style = `
    position: fixed; left:0; top:0; width:100vw; height:100vh; z-index:10001;
    background: rgba(0,0,0,0.18); display:flex; align-items:center; justify-content:center;
  `;

  // Строим селект из дат
  let isReady = !!request.ready;
  let today = new Date().toISOString().slice(0, 10);
  const availableDates = (request.loading_dates || []).filter(ld => (ld.truck_count || 0) > 0);
  const datesOptions = availableDates.map(ld =>
    `<option value="${ld.date}">${ld.date} (${ld.truck_count} машин)</option>`
  ).join('');
  let dateInputHtml = '';

  if (isReady) {
    dateInputHtml = `
      <input type="date" class="form-control" id="driver-date" min="${today}" required>
    `;
  } else {
    dateInputHtml = `
      <select class="form-select" id="driver-date" required>
        <option value="">Выберите дату...</option>
        ${datesOptions}
      </select>
    `;
  }


  
  modal.innerHTML = `
    <div style="background:#fff; max-width:400px; width:96vw; max-height:92vh; overflow:auto; padding:22px 16px 16px 16px; border-radius:13px; box-shadow:0 2px 24px #b0c2e9;">
      <h5 class="mb-3">Добавить водителя</h5>
      <form id="driver-form">
        <div class="mb-2">
          <label>Имя водителя</label>}
          <input type="text" class="form-control" id="driver-name" required>
        </div>
        <div class="mb-2">
          <label>Фамилия водителя</label>
          <input type="text" class="form-control" id="driver-surname" required>
        </div>
        <div class="mb-2">
          <label>Номер транспортного средства</label>
          <input type="text" class="form-control" id="driver-carNumber" required>
        </div>
        <div class="mb-2">
          <label>Дата погрузки</label>
          ${dateInputHtml}
        </div>
        <div class="mb-2">
          <label>Файлы</label>
          <input type="file" class="form-control" id="driver-files" multiple>
        </div>
        <div class="d-flex justify-content-end gap-2 mt-3">
          <button type="submit" class="btn btn-primary">Сохранить</button>
          <button type="button" class="btn btn-outline-secondary" id="driver-cancel-btn">Отмена</button>
        </div>
      </form>
    </div>
  `;

  document.body.appendChild(modal);

  modal.querySelector('#driver-cancel-btn').onclick = () => modal.remove();

  modal.querySelector('#driver-form').onsubmit = async function(e) {
    e.preventDefault();
    const name = modal.querySelector('#driver-name').value.trim();
    const surname = modal.querySelector('#driver-surname').value.trim();
    const carNumber = modal.querySelector('#driver-carNumber').value.trim();
    const selectedDate = modal.querySelector('#driver-date').value;
    const files = modal.querySelector('#driver-files').files;

    if (!selectedDate) {
      alert("Выберите дату погрузки!");
      return;
    }

    // --- ДОБАВЛЯЕМ ВОДИТЕЛЯ ---
    // 1. Добавляем в request.drivers (создаём если нет)
    if (!Array.isArray(request.drivers)) request.drivers = [];
    const newDriver = {
      name,
      surname,
      carNumber,
      date: selectedDate,
      files: []
    };
    // ← зафиксировать момент заполнения карточки (добавляем 1 раз)
    newDriver.assignedAt = new Date().toISOString();
    // ← ник того, кто добавил водителя
    newDriver.addedByNick = localStorage.getItem('jm_session_username') || 'user';

    // 2. Файлы (если есть) — сохраняем через сервер (добавишь позже)
    // Можно реализовать отправку каждого файла как отдельный запрос
    // Пока оставляем поле files пустым или пушим file.name
    for (let f of files) {
      try {
        const result = await uploadDriverFileWS(f, request.id);
        newDriver.files.push(result);
      } catch (err) {
        alert("Ошибка загрузки файла: " + f.name + "\n" + (err.message || ''));
        console.error('Ошибка загрузки:', err);
        return;
      }
    }



    request.drivers.push(newDriver);

    // 3. Уменьшаем количество машин в выбранной дате
    if (request.ready) {
      if (Array.isArray(request.loading_dates) && request.loading_dates.length > 0) {
        request.loading_dates[0].truck_count = Math.max(0, (parseInt(request.loading_dates[0].truck_count) || 1) - 1);
      }
    } else {
      const ld = (request.loading_dates || []).find(ld => ld.date === selectedDate);
      if (ld) {
        ld.truck_count = Math.max(0, (parseInt(ld.truck_count) || 1) - 1);
      }
    }

    // --- 3.1. Перевод в 'current' только когда на всех датах осталось 0 машин ---
    const totalRemaining = Array.isArray(request.loading_dates)
      ? request.loading_dates.reduce((sum, ld) => {
          const n = Number(ld && ld.truck_count);
          return sum + (Number.isFinite(n) ? n : 0);
        }, 0)
      : null;

    if (totalRemaining !== null && totalRemaining <= 0) {
      request.status = "current";
    }

    // 4. Отправляем заявку на сервер (edit_request)
    try {
      await WebSocketService.sendAndWait({
        action: "edit_request",
        id: request.id,
        editor: localStorage.getItem('jm_session_username') || 'user',
        data: request
      });

      modal.remove(); // закрываем окно в любом случае после успешного сохранения

      // Локально уведомим подписчиков безопасно
      emitLocal('request_updated', {
        action: 'request_updated',
        data: {
          ...request,
          last_editor: localStorage.getItem('jm_session_username') || 'user',
          last_edit_ts: new Date().toISOString().slice(0,19).replace('T',' ')
        }
      });

      const editorNick = localStorage.getItem('jm_session_username') || 'user';
      window.dispatchEvent(new CustomEvent('driver:assigned', {
        detail: {
          requestId: request.id,
          request: request,
          driver: newDriver,
          date: newDriver.assignedAt,
          nick: editorNick
        }
      }));

    } catch (err) {
      alert("Ошибка добавления водителя: " + err.message);
    }
  };
}

export function showDriverContextMenu(e, requestId, driverIdx) {
  // Удалить предыдущее меню если было
  document.getElementById('driver-context-menu')?.remove();

  const menu = document.createElement('div');
  menu.id = 'driver-context-menu';
  menu.style = `
    position: fixed;
    left: ${e.clientX}px; top: ${e.clientY}px;
    background: #fff; box-shadow: 0 3px 10px #0004;
    border-radius: 6px; padding: 6px 0;
    z-index: 10000;
    min-width: 140px;
  `;

  // Кнопка "Редактировать"
  const editBtn = document.createElement('button');
  editBtn.className = 'dropdown-item btn btn-light w-100';
  editBtn.textContent = 'Редактировать';
  editBtn.onclick = () => {
    openEditDriverModal(requestId, driverIdx);
    menu.remove();
  };
  menu.appendChild(editBtn);

  // Кнопка "Удалить"
  const delBtn = document.createElement('button');
  delBtn.className = 'dropdown-item btn btn-danger w-100';
  delBtn.textContent = 'Удалить';
  delBtn.onclick = () => {
    menu.remove();
    confirmDeleteDriver(requestId, driverIdx);
  };
  menu.appendChild(delBtn);

  document.body.appendChild(menu);

  setTimeout(() => {
    window.addEventListener('mousedown', function closeMenu(ev) {
      if (!menu.contains(ev.target)) {
        menu.remove();
        window.removeEventListener('mousedown', closeMenu);
      }
    });
  }, 10);
}

function confirmDeleteDriver(requestId, driverIdx) {
  if (document.getElementById('driver-delete-modal')) return;
  const modal = document.createElement('div');
  modal.id = 'driver-delete-modal';
  modal.style = `
    position: fixed; left:0; top:0; width:100vw; height:100vh; z-index:10001;
    background: rgba(0,0,0,0.18); display:flex; align-items:center; justify-content:center;
  `;
  modal.innerHTML = `
    <div style="background:#fff; max-width:350px; width:96vw; padding:22px 16px; border-radius:13px; box-shadow:0 2px 24px #b0c2e9;">
      <h5 class="mb-3">Удалить водителя</h5>
      <div>Вы действительно хотите удалить этого водителя?</div>
      <div class="d-flex justify-content-end gap-2 mt-4">
        <button class="btn btn-danger" id="driver-delete-yes">Да</button>
        <button class="btn btn-outline-secondary" id="driver-delete-no">Нет</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelector('#driver-delete-no').onclick = () => modal.remove();
  modal.querySelector('#driver-delete-yes').onclick = async () => {
    const announcements = window.announcements;
    const request = announcements.find(r => String(r.id) === String(requestId));
    if (request && Array.isArray(request.drivers)) {
      // 1. Получаем дату водителя
      const driver = request.drivers[driverIdx];
      if (driver && driver.date) {
        if (request.ready) {
          // Для "Груз готов" — всегда 1 дата, возвращаем машину
          if (Array.isArray(request.loading_dates) && request.loading_dates.length > 0) {
            request.loading_dates[0].truck_count = (parseInt(request.loading_dates[0].truck_count) || 0) + 1;
          }
        } else {
          // Для обычных дат — ищем по дате
          const ld = (request.loading_dates || []).find(ld => ld.date === driver.date);
          if (ld) {
            ld.truck_count = (parseInt(ld.truck_count) || 0) + 1;
          }
        }
      }

      // 2. Удаляем водителя
      request.drivers.splice(driverIdx, 1);

      // --- Проверка: если появилась хоть одна свободная машина — статус заявки становится priority, и заявка идёт в начало списка ---
      let freePlace = false;
      if (request.ready) {
        freePlace = (Array.isArray(request.loading_dates) && request.loading_dates.length > 0)
          ? Number(request.loading_dates[0].truck_count) > 0
          : false;
      } else {
        freePlace = (request.loading_dates || []).some(ld => (ld.truck_count || 0) > 0);
      }
      if (freePlace) {
        request.status = "priority";
        request.timestamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
      }

      await WebSocketService.sendAndWait({
        action: "edit_request",
        id: request.id,
        editor: localStorage.getItem('jm_session_username') || 'user',
        data: request
      });

      // PUSH локально — сразу
      emitLocal('new_request', {
        action: 'new_request',
        data: { ...request }
      });

    }
    modal.remove();
  };
}

export function openEditDriverModal(requestId, driverIdx) {
  document.getElementById('edit-driver-modal')?.remove();

  const announcements = window.announcements;
  const request = announcements.find(r => String(r.id) === String(requestId));
  if (!request || !Array.isArray(request.drivers) || !request.drivers[driverIdx]) return;

  const driver = request.drivers[driverIdx];
  let isReady = !!request.ready;
  let today = new Date().toISOString().slice(0, 10);

  let availableDates = (request.loading_dates || []).filter(ld => (ld.truck_count || 0) > 0);
  // Дата текущего водителя (строкой, для сравнения)
  let driverDate = driver.date;

  // Если среди доступных дат нет той, что выбрана у водителя — добавь её вручную
  if (
    driverDate &&
    !availableDates.find(ld => ld.date === driverDate)
  ) {
    // Найдём truck_count для этой даты (или 0 если нет)
    let ld = (request.loading_dates || []).find(ld => ld.date === driverDate);
    availableDates.push({
      date: driverDate,
      truck_count: ld ? ld.truck_count : 0
    });
  }

  // Теперь рендерим select
  const datesOptions = availableDates.map(ld =>
    `<option value="${ld.date}">${ld.date} (${ld.truck_count} машин)</option>`
  ).join('');

  let dateInputHtml = `
    <select class="form-select" id="driver-date" required>
      <option value="">Выберите дату...</option>
      ${datesOptions}
    </select>
  `;

  const modal = document.createElement('div');
  modal.id = 'edit-driver-modal';
  modal.style = `
    position: fixed; left:0; top:0; width:100vw; height:100vh; z-index:10001;
    background: rgba(0,0,0,0.18); display:flex; align-items:center; justify-content:center;
  `;
  modal.innerHTML = `
    <div style="background:#fff; max-width:400px; width:96vw; max-height:92vh; overflow:auto; padding:22px 16px 16px 16px; border-radius:13px; box-shadow:0 2px 24px #b0c2e9;">
      <h5 class="mb-3">Редактировать водителя</h5>
      <form id="edit-driver-form">
        <div class="mb-2">
          <label>Имя водителя</label>
          <input type="text" class="form-control" id="driver-name" required value="${driver.name || ''}">
        </div>
        <div class="mb-2">
          <label>Фамилия водителя</label>
          <input type="text" class="form-control" id="driver-surname" required value="${driver.surname || ''}">
        </div>
        <div class="mb-2">
          <label>Номер транспортного средства</label>
          <input type="text" class="form-control" id="driver-carNumber" required value="${driver.carNumber || ''}">
        </div>
        <div class="mb-2">
          <label>Дата погрузки</label>
          ${dateInputHtml}
        </div>
        <div class="mb-2">
          <label>Файлы</label>
          <input type="file" class="form-control" id="driver-files" multiple>
        </div>
        <div class="d-flex justify-content-end gap-2 mt-3">
          <button type="submit" class="btn btn-primary">Сохранить</button>
          <button type="button" class="btn btn-outline-secondary" id="driver-cancel-btn">Отмена</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(modal);

  // Если не "Груз готов" — выставить значение селекта
  if (!isReady) {
    setTimeout(() => {
      const sel = modal.querySelector('#driver-date');
      if (sel && driver.date) sel.value = driver.date;
    }, 10);
  }

  modal.querySelector('#driver-cancel-btn').onclick = () => modal.remove();

  modal.querySelector('#edit-driver-form').onsubmit = async function(e) {
    e.preventDefault();
    const name = modal.querySelector('#driver-name').value.trim();
    const surname = modal.querySelector('#driver-surname').value.trim();
    const carNumber = modal.querySelector('#driver-carNumber').value.trim();
    const selectedDate = modal.querySelector('#driver-date').value;
    const files = modal.querySelector('#driver-files').files;

    if (!selectedDate) {
      alert("Выберите дату погрузки!");
      return;
    }

    // --- Сохраняем старую дату до изменения ---
    const oldDate = driver.date;

    // --- Перераспределяем машину, если дата изменилась ---
    if (selectedDate !== oldDate) {
      // 1. Вернуть машину в старую дату
      if (request.ready) {
        // "Груз готов": дата может быть любой, всегда первая loading_dates
        if (Array.isArray(request.loading_dates) && request.loading_dates.length > 0) {
          request.loading_dates[0].truck_count = (parseInt(request.loading_dates[0].truck_count) || 0) + 1;
        }
      } else {
        const ldOld = (request.loading_dates || []).find(ld => ld.date === oldDate);
        if (ldOld) {
          ldOld.truck_count = (parseInt(ldOld.truck_count) || 0) + 1;
        }
      }
      // 2. Забрать машину в новую дату
      if (request.ready) {
        // "Груз готов": опять же первая loading_dates
        if (Array.isArray(request.loading_dates) && request.loading_dates.length > 0) {
          request.loading_dates[0].truck_count = Math.max(0, (parseInt(request.loading_dates[0].truck_count) || 1) - 1);
        }
      } else {
        const ldNew = (request.loading_dates || []).find(ld => ld.date === selectedDate);
        if (ldNew) {
          ldNew.truck_count = Math.max(0, (parseInt(ldNew.truck_count) || 1) - 1);
        }
      }
    }


    // --- Изменяем данные водителя ---
    driver.name = name;
    driver.surname = surname;
    driver.carNumber = carNumber;
    driver.date = selectedDate;
    if (!driver.assignedAt) driver.assignedAt = new Date().toISOString();

    // Файлы — добавить если есть новые
    for (let f of files) {
      try {
        const result = await uploadDriverFileWS(f, request.id);
        if (!driver.files) driver.files = [];
        driver.files.push(result);
      } catch (err) {
        alert("Ошибка загрузки файла: " + f.name + "\n" + (err.message || ''));
        console.error('Ошибка загрузки:', err);
        return;
      }
    }
    // --- Отправляем заявку на сервер ---
    try {
      await WebSocketService.sendAndWait({
        action: "edit_request",
        id: request.id,
        editor: localStorage.getItem('jm_session_username') || 'user',
        data: request
      });
      modal.remove();

      emitLocal('request_updated', {
        action: 'request_updated',
        data: {
          ...request,
          last_editor: localStorage.getItem('jm_session_username') || 'user',
          last_edit_ts: new Date().toISOString().slice(0,19).replace('T',' ')
        }
      });

      const editorNick = localStorage.getItem('jm_session_username') || 'user';
      // === Уведомить статистику: добавлен водитель ===
      window.dispatchEvent(new CustomEvent('driver:assigned', {
        detail: {
          requestId: request.id,
          request: request,
          driver: driver,               // ← правим: отправляем текущего driver
          date: driver.assignedAt,      // ← не меняем «дату заполнения карточки»
          nick: editorNick              // ← кто сделал изменение/добавление
        }
      }));

      modal.remove();
    } catch (err) {
      alert("Ошибка изменения водителя: " + err.message);
    }
  };
}







