// frontend/js/services/api.js

import { installPriorityRinger, handleWsForPriority } from './notifications.js';
// Инициируем глобальный «звонок» (идемпотентно — повторные вызовы безопасны)
installPriorityRinger();

//   localStorage.setItem('ws_host_local', '192.168.0.101');
//
//   // Обычно 8766. Если ваш RTR даёт только HTTPS/WSS, укажите 443.
//   localStorage.setItem('ws_port_local', '8766');
//   localStorage.setItem('ws_host_rtr',   'ВАШ_RTR_ДОМЕН'); // напр. xxxx.trycloudflare.com
//   localStorage.setItem('ws_port_rtr',   '443');           // 443 для WSS через туннель
//
//   // Опционально: жёстко выбрать маршрут
//   // localStorage.setItem('ws_force', 'local'); // или 'rtr'

const isMobile = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
const isPrivateHost = (h) =>
  /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[0-1])\.)/.test(h) ||
  h.endsWith('.lan') || h.endsWith('.local');

const buildWsUrl = (host, port, secure) =>
  `${secure ? 'wss' : 'ws'}://${host}${port ? `:${port}` : ''}`;

// Значения по умолчанию:
// - локальный: текущий hostname и порт 8766
// - RTR: по умолчанию тоже текущий hostname (если страница открыта через туннель),
//        иначе надо один раз прописать ws_host_rtr в localStorage
const WS_HOST_LOCAL = localStorage.getItem('ws_host_local') || location.hostname;
const WS_PORT_LOCAL = Number(localStorage.getItem('ws_port_local') || 8766);
const WS_HOST_RTR   = localStorage.getItem('ws_host_rtr')   || location.hostname;
const WS_PORT_RTR   = Number(localStorage.getItem('ws_port_rtr') ||
                      (location.protocol === 'https:' ? 443 : 8766));
const WS_FORCE      = (localStorage.getItem('ws_force') || '').toLowerCase(); // '', 'local', 'rtr'

// На каждой попытке подключения/реконнекта чередуем local↔RTR,
// используя счётчик WebSocketService.reconnectAttempts.
// По умолчанию мобильным — RTR, десктопам в LAN — локальный.
const WS_URL = () => {
  const attempts =
    (typeof WebSocketService !== 'undefined' && WebSocketService.reconnectAttempts)
      ? WebSocketService.reconnectAttempts
      : 0;

  // если явно не указано ws_force:
  // - мобильные или «внешние» хосты -> предпочитаем RTR
  // - частная сеть -> предпочитаем local
  const preferRtr = WS_FORCE
    ? (WS_FORCE === 'rtr')
    : (isMobile() || !isPrivateHost(location.hostname));

  // Если предпочитаем RTR — первая попытка идёт в RTR, затем чередуем; иначе наоборот.
  const useRtrFirst = preferRtr;
  const useRtr = useRtrFirst ? (attempts % 2 === 0) : (attempts % 2 === 1);

  if (useRtr) {
    // через туннель почти всегда нужен WSS
    return buildWsUrl(WS_HOST_RTR, WS_PORT_RTR, /*secure*/ true);
  }

  // локально — протокол берём по странице (http->ws, https->wss)
  const secureByPage = (location.protocol === 'https:');
  return buildWsUrl(WS_HOST_LOCAL, WS_PORT_LOCAL, secureByPage);
};


export class WebSocketService {
  static ws = null;
  static connected = false;
  static reconnectAttempts = 0;
  static maxReconnectDelay = 15000;
  static callbacks = {};     // { action: Set<fn> }
  static waiters = {};       // { expectedAction: fn(resolve) }
  static pingTimer = null;

  static responseActions = {
    add_request: 'new_request',
    edit_request: 'request_updated',
    update_request: 'request_updated', // 👈 сервер уже шлёт request_updated
    upload_file: 'upload_file',
    download_file: 'download_file',
    set_request_status: 'request_updated'
  };


  // Подписка на сообщения конкретного action
  static on(action, cb) {
    if (!this.callbacks[action]) this.callbacks[action] = new Set();
    this.callbacks[action].add(cb);
    this.connect(); // гарантируем соединение
    return () => this.off(action, cb);
  }

  static off(action, cb) {
    if (this.callbacks[action]) this.callbacks[action].delete(cb);
  }

  static _emit(action, payload) {
    const set = this.callbacks[action];
    if (set && set.size) for (const fn of set) { try { fn(payload); } catch {} }
  }
  // ↓↓↓ НОВОЕ
  static emit(action, payload) { this._emit(action, payload); }

  static connect() {
    if (this.connected && this.ws && this.ws.readyState === WebSocket.OPEN) return this.ws;
    if (this.ws && (this.ws.readyState === WebSocket.CONNECTING)) return this.ws;

    try {
      const url = WS_URL();
      const ws = new WebSocket(url);
      this.ws = ws;

      ws.onopen = () => {
        this.connected = true;
        this.reconnectAttempts = 0;

        // возобновляем сессию, если есть
        const token = localStorage.getItem('jm_session_token');
        if (token) { try { ws.send(JSON.stringify({ action: 'resume_session', token })); } catch {} }

        // первичная синхронизация
        try { ws.send(JSON.stringify({ action: 'sync_all' })); } catch {}

        // лёгкий ping, чтобы не засыпало соединение (не обязателен для сервера)
        clearInterval(this.pingTimer);
        this.pingTimer = setInterval(() => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            try { this.ws.send(JSON.stringify({ action: 'ping', t: Date.now() })); } catch {}
          }
        }, 30000);
      };

      ws.onmessage = (ev) => {
        let msg = null;
        try { msg = JSON.parse(ev.data); } catch { return; }
        const act = msg?.action || msg?.type || 'message';
        // ...
        // 1) waiter (sendAndWait) — поддержка массива ожидателей
        const bucket = this.waiters[act];
        if (Array.isArray(bucket) && bucket.length) {
          delete this.waiters[act];
          for (const w of bucket) {
            try { clearTimeout(w.__to); w.__resolve(msg); } catch {}
          }
        } else if (typeof bucket === 'function') {
          // на случай старых путей
          try { bucket(msg); } finally { delete this.waiters[act]; }
        }

        // 2) подписчики
        this._emit(act, msg);
      };

      ws.onclose = () => {
        this.connected = false;
        clearInterval(this.pingTimer);
        this._scheduleReconnect();
      };

      ws.onerror = () => {
        // браузер сам вызовет onclose; ускорим реконнект
        try { ws.close(); } catch {}
      };

      return ws;
    } catch {
      this._scheduleReconnect();
      return null;
    }
  }

  static _scheduleReconnect() {
    if (this.connected) return; // уже переподключились
    const attempt = Math.min(++this.reconnectAttempts, 10);
    const delay = Math.min(500 * attempt * attempt, this.maxReconnectDelay);
    setTimeout(() => this.connect(), delay);
  }

  static _ensureOpen() {
    const ws = this.connect();
    if (!ws) throw new Error('Нет WebSocket соединения');
    return ws;
  }

  // Простой send без ожидания ответа
  static send(obj) {
    const ws = this._ensureOpen();
    const payload = (typeof obj === 'string') ? obj : JSON.stringify(obj);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    } else {
      ws.addEventListener('open', () => ws.send(payload), { once: true });
    }
  }

  // Отправка с ожиданием конкретного ответа (action)
  static sendAndWait(data, expectedAction) {
    const ws = this._ensureOpen();
    const want = expectedAction || this.responseActions[data?.action] || data?.action;
    const timeoutMs = (want === 'resume_session') ? 45000 : 15000;

    return new Promise((resolve, reject) => {
      const entry = { __resolve: resolve, __reject: reject, __to: null };

      entry.__to = setTimeout(() => {
        // снять только текущий entry
        const arr = this.waiters[want];
        if (Array.isArray(arr)) {
          const i = arr.indexOf(entry);
          if (i >= 0) arr.splice(i, 1);
          if (arr.length === 0) delete this.waiters[want];
        } else if (arr) {
          delete this.waiters[want];
        }
        reject(new Error('Сервер не ответил'));
      }, timeoutMs);

      if (!this.waiters[want]) this.waiters[want] = [];
      if (!Array.isArray(this.waiters[want])) this.waiters[want] = [this.waiters[want]];
      this.waiters[want].push(entry);

      const payload = JSON.stringify(data);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
      } else {
        ws.addEventListener('open', () => ws.send(payload), { once: true });
      }
    });
  }
}
