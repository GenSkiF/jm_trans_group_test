// frontend/js/pages/maps/index.js — ПОЛНАЯ ВЕРСИЯ (СТАЛО)
let _map, _tileLayer, _routeLayer, _markersLayer;
let _lastMode = 'overview'; // 'overview' | 'focus'
let _geocodeCache = new Map(); // key: cityName -> {lat, lon}
let _pending = 0;
let _drawToken = 0; // ← токен для отмены «устаревших» отрисовок

// ——— Снимаем возможный «скелет»/блюр-оверлей
function clearLoadingOverlay() {
  try {
    const root = document.getElementById('maps-root') || document.getElementById('map-root') || document.body;
    root.classList.remove('blur', 'blurred', 'is-loading');

    const byId = ['map-skeleton', 'maps-skeleton', 'loading-overlay'];
    byId.forEach(id => { const el = document.getElementById(id); if (el) el.remove(); });

    // иногда кладут полупрозрачные div поверх карты:
    document.querySelectorAll('.map-overlay, .overlay, .loading, .backdrop').forEach(el => el.remove());
  } catch {}
}

// === Публичные функции ===
export async function showMapsSection() {
  _ensureContainer();
  await _ensureLeaflet();
  _ensureMap();
  clearLoadingOverlay();

    // ——— Если пользователь кликнул кнопку «Карта», показываем обзор ОДИН раз
  if (window.__forceOverviewOnce) {
    window.__forceOverviewOnce = false;      // сброс одноразового флага
    _lastMode = 'overview';                   // переключаем внутренний режим
    window.__lastFocusedRequest = null;       // забываем прошлый фокус
    window.__lastRouteRequestId  = null;      // и «маячок» маршрута
    await showOverviewOnMap();
    _resizeMapSoon();
    return;
  }

  // 1) Если клик по компасу уже сохранил id — отрабатываем фокус немедленно
  const pendingId = window.__lastRouteRequestId;
  if (pendingId) {
    const list = Array.isArray(window.announcements) ? window.announcements : [];
    const req = list.find(r => String(r.id) === String(pendingId) || String(r.request_id) === String(pendingId));
    if (req) {
      _lastMode = 'focus';
      window.__lastFocusedRequest = req;
      await openRouteOnMapForRequest(req);
      window.__lastRouteRequestId = null; // ← сбросили маячок
      _resizeMapSoon();
      return; // ← обзор не рисуем
    }
  }

  // 2) Иначе — если раньше был задан фокус, повторяем фокус
  if (_lastMode === 'focus' && window.__lastFocusedRequest) {
    await openRouteOnMapForRequest(window.__lastFocusedRequest);
  } else {
    // 3) Фолбэк: отрисовать обзор
    await showOverviewOnMap();
  }
  _resizeMapSoon();
}

export async function openRouteOnMapForRequest(reqOrId) {
  const token = ++_drawToken;             // ← фиксируем «версию» отрисовки
  window.__lastFocusedRequest = reqOrId;
  _lastMode = 'focus';
  _ensureContainer();
  await _ensureLeaflet();
  _ensureMap();

  // 1) Гарантируем объект заявки даже если пришёл только id
  let req = reqOrId;
  if (typeof reqOrId !== 'object') {
    const id = String(reqOrId);
    const list = Array.isArray(window.announcements) ? window.announcements : [];
    req = list.find(r => String(r.id) === id || String(r.request_id) === id) || null;
  }
  if (!req) { _toast('Заявка не найдена'); return; }

  // 2) Аккуратно достаём точки через ваш хелпер
  const fromPt = await extractPoint(req, 'from');   // {lat, lon, label} или null
  const toPt   = await extractPoint(req, 'to');     // {lat, lon, label} или null
  if (!fromPt || !toPt) { _toast('Не удалось определить координаты для маршрута.'); return; }

  // Если за это время стартовала другая отрисовка — прекращаем текущую
  if (token !== _drawToken) return;

  // 3) Делаем функцию доступной глобально для вызова из других страниц
  window.openRouteOnMapForRequest = openRouteOnMapForRequest;

  // 4) Чистим и рисуем
  _clearMap();

  // Маркеры A/B
  const fromMarker = L.circleMarker([fromPt.lat, fromPt.lon], { radius: 9, weight: 2 })
    .bindTooltip(fromPt.label || 'Откуда', { direction: 'top', offset: [0, -10] })
    .addTo(_markersLayer);
  fromMarker.setStyle({ color: '#1a7f37', fillColor: '#1a7f37', fillOpacity: 0.85 });

  const toMarker = L.circleMarker([toPt.lat, toPt.lon], { radius: 9, weight: 2 })
    .bindTooltip(toPt.label || 'Куда', { direction: 'top', offset: [0, -10] })
    .addTo(_markersLayer);
  toMarker.setStyle({ color: '#1f6feb', fillColor: '#1f6feb', fillOpacity: 0.85 });

  // Клик по A/B — отфильтровать «Заявки» по городу и показать только их
  const cityFrom = fromPt.label || req.from_city || req.city_from || req.from || req.fromCity || '';
  const cityTo   = toPt.label   || req.to_city   || req.city_to   || req.to   || req.toCity   || '';

  const backFilter = (cityName, ev) => {
    try { if (window.L?.DomEvent && ev) L.DomEvent.stop(ev); } catch {}
    if (typeof window.filterAnnouncementsByCity === 'function') {
      window.filterAnnouncementsByCity(String(cityName || ''));
    }
    if (typeof window.showSection === 'function') window.showSection('announcements');
  };

  fromMarker.on('click', (ev) => backFilter(cityFrom, ev));
  toMarker.on('click',   (ev) => backFilter(cityTo,   ev));


  // 5) Маршрут через OSRM (если упадёт — рисуем прямую)
  const route = await _routeBetween(fromPt, toPt);
  if (route?.geometry?.coordinates?.length) {
    const line = L.geoJSON(route.geometry, { style: { weight: 5, opacity: 0.9 } });
    line.setStyle({ color: '#1f6feb' });
    line.addTo(_routeLayer);

    const start = route.geometry.coordinates[0];
    const end   = route.geometry.coordinates[route.geometry.coordinates.length - 1];
    L.circleMarker([start[1], start[0]], { radius: 4, color:'#1a7f37', fillColor:'#1a7f37', fillOpacity:1 }).addTo(_routeLayer);
    L.circleMarker([end[1],   end[0]],   { radius: 4, color:'#1f6feb', fillColor:'#1f6feb', fillOpacity:1 }).addTo(_routeLayer);

    _fitAll();
  } else {
    L.polyline([[fromPt.lat, fromPt.lon], [toPt.lat, toPt.lon]], { weight: 4 }).addTo(_routeLayer);
    _fitAll();
  }

  _resizeMapSoon();
}
// --- Глобальная доступность функций карты при загрузке модуля
if (!window.openRouteOnMapForRequest) {
  window.openRouteOnMapForRequest = openRouteOnMapForRequest;
}
if (!window.showMapsSection) {
  window.showMapsSection = showMapsSection;
}



export async function showOverviewOnMap() {
  _lastMode = 'overview';
  const token = ++_drawToken;            // ← фиксируем «версию» отрисовки
  _ensureContainer();
  await _ensureLeaflet();
  _ensureMap();

  // Возможно, пока грузились зависимости, включился «фокус»
  if (token !== _drawToken) return;

  _clearMap();

  const list = await _getActiveAndPriorityRequests();
  if (!list?.length) { _toast('Активных/приоритетных заявок не найдено'); return; }

  // Группируем маркеры
  const group = L.featureGroup().addTo(_markersLayer);

  for (const req of list) {
    // Если в процессе пользователь кликнул по компасу — обрываем «обзор»
    if (token !== _drawToken) return;
    const fromPt = await extractPoint(req, 'from');
    const toPt   = await extractPoint(req, 'to');
    if (!fromPt || !toPt) continue;

    const m1 = L.circleMarker([fromPt.lat, fromPt.lon], { radius: 6, weight: 1, opacity: 0.9 })
      .bindTooltip((fromPt.label || 'Откуда'), {direction:'top', offset:[0,-8]})
      .addTo(group);
    m1.setStyle({ color: '#1a7f37', fillColor: '#1a7f37', fillOpacity: 0.7 });

    const m2 = L.circleMarker([toPt.lat, toPt.lon], { radius: 6, weight: 1, opacity: 0.9 })
      .bindTooltip((toPt.label || 'Куда'), {direction:'top', offset:[0,-8]})
      .addTo(group);
    m2.setStyle({ color: '#1f6feb', fillColor: '#1f6feb', fillOpacity: 0.7 });

    // Тонкая линия между точками (без роутинга, чтобы не убить API)
    L.polyline([[fromPt.lat, fromPt.lon], [toPt.lat, toPt.lon]], { weight: 1, opacity: 0.4 }).addTo(_routeLayer);

    // Клик — перейти в фокус-мод на конкретную заявку
    m1.on('click', () => {
      const cityFrom = req.from_city || req.city_from || req.from || '';
      if (window.filterAnnouncementsByCity) {
        window.filterAnnouncementsByCity(cityFrom);
        if (typeof window.showSection === 'function') window.showSection('announcements');
      }
    });

    m2.on('click', () => {
      const cityTo = req.to_city || req.city_to || req.to || '';
      if (window.filterAnnouncementsByCity) {
        window.filterAnnouncementsByCity(cityTo);
        if (typeof window.showSection === 'function') window.showSection('announcements');
      }
    });

  }

  _fitAll();
  _resizeMapSoon();
}

// === Вспомогательные ===
function _ensureContainer() {
  const host = document.getElementById('page-maps');
  if (!host) return;
  if (!document.getElementById('map-root')) {
    host.innerHTML = `
      <div id="map-root" style="position:relative;width:100%;height:calc(100vh - 160px);min-height:420px;border-radius:16px;overflow:hidden;box-shadow:0 8px 30px rgba(0,0,0,.08)"></div>
    `;
  }
}

async function _ensureLeaflet() {
  if (window.L && typeof window.L.map === 'function') return true;

  // CSS
  if (!document.querySelector('link[data-leaflet]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    link.setAttribute('data-leaflet','1');
    document.head.appendChild(link);
  }

  // JS
  if (!document.querySelector('script[data-leaflet]')) {
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      s.async = true;
      s.setAttribute('data-leaflet','1');
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  // Ждём, пока L действительно появится (до ~2.5s)
  const t0 = Date.now();
  while (!(window.L && typeof window.L.map === 'function')) {
    await new Promise(r => setTimeout(r, 50));
    if (Date.now() - t0 > 2500) throw new Error('Leaflet failed to load');
  }
  return true;
}

function _ensureMap() {
  if (_map) return _map;
  const root = document.getElementById('map-root');
  _map = L.map(root, { zoomControl: true, attributionControl: true }).setView([41.7167, 44.7833], 6);
  _tileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap'
  });
  _tileLayer.addTo(_map);
  _routeLayer = L.layerGroup().addTo(_map);
  _markersLayer = L.layerGroup().addTo(_map);

  // Автоматический ресайз
  window.addEventListener('resize', _resizeMapSoon);
  setTimeout(_resizeMapSoon, 50);
  return _map;
}

function _clearMap() {
  _routeLayer?.clearLayers();
  _markersLayer?.clearLayers();
}

function _fitAll() {
  const group = L.featureGroup([_routeLayer, _markersLayer].flatMap(l => l.getLayers()));
  try {
    _map.fitBounds(group.getBounds().pad(0.2), { animate: true });
  } catch {}
}

function _resizeMapSoon() {
  if (!_map) return;
  clearTimeout(_resizeMapSoon._t);
  _resizeMapSoon._t = setTimeout(() => {
    _map.invalidateSize();
  }, 60);
}

// Получить список активных/приоритетных заявок
async function _getActiveAndPriorityRequests() {
  // 1) если уже загружены в окне "Заявки"
  if (Array.isArray(window.announcements) && window.announcements.length) {
    return window.announcements.filter(_isActiveOrPriority);
  }
  // 2) иначе попробуем достать из localStorage (как кэш)
  try {
    const raw = localStorage.getItem('announcements');
    if (raw) {
      const list = JSON.parse(raw);
      if (Array.isArray(list)) return list.filter(_isActiveOrPriority);
    }
  } catch {}
  // 3) как запасной вариант — спросим у вашего WebSocket/REST если доступно
  try {
    if (window.WebSocketService?.request) {
      const resp = await window.WebSocketService.request('list_requests');
      if (Array.isArray(resp?.data)) return resp.data.filter(_isActiveOrPriority);
    }
  } catch {}
  return [];
}

function _isActiveOrPriority(r) {
  const s = String(r?.status ?? r?.state ?? '').toLowerCase();
  return ['active','priority','актив','приор','prior'].some(key => s.includes(key));
}

// === Извлечение точек и геокод ===
export async function extractPoint(req, kind) {
  const isFrom = (String(kind).toLowerCase() === 'from');

  // Пробуем координаты
  const latKeys = isFrom ? ['from_lat','lat_from','fromLat','latFrom'] : ['to_lat','lat_to','toLat','latTo'];
  const lonKeys = isFrom ? ['from_lon','from_lng','lon_from','lng_from','fromLon','fromLng'] : ['to_lon','to_lng','lon_to','lng_to','toLon','toLng'];

  let lat, lon;
  for (const k of latKeys) if (k in (req||{})) { lat = parseFloat(req[k]); break; }
  for (const k of lonKeys) if (k in (req||{})) { lon = parseFloat(req[k]); break; }
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    return { label: _makeLabel(req, isFrom), lat, lon };
  }

  // Иначе — строка города
  const name = _pickCityName(req, isFrom);
  if (!name) return null;

  const { lat: glat, lon: glon } = await _geocodeCity(name);
  if (!Number.isFinite(glat) || !Number.isFinite(glon)) return null;
  return { label: name, lat: glat, lon: glon };
}

function _pickCityName(req, isFrom) {
  const keys = isFrom
    ? ['from','from_city','city_from','fromCity','direction_from','origin','город_откуда','откуда']
    : ['to','to_city','city_to','toCity','direction_to','destination','город_куда','куда'];
  for (const k of keys) {
    const v = req?.[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

function _makeLabel(req, isFrom) {
  const name = _pickCityName(req, isFrom);
  return name || '';
}

// Простой геокод через Nominatim с кэшем в памяти + localStorage
async function _geocodeCity(q) {
  const key = q.toLowerCase();
  if (_geocodeCache.has(key)) return _geocodeCache.get(key);
  try {
    const ls = localStorage.getItem('geo:'+key);
    if (ls) {
      const obj = JSON.parse(ls);
      _geocodeCache.set(key, obj);
      return obj;
    }
  } catch {}

  // Небольшая защита от спама
  _pending++;
  if (_pending > 6) await new Promise(r => setTimeout(r, 300));
  try {
    const lang = (localStorage.getItem('ui_lang') || document.documentElement.lang || navigator.language || 'en')
      .split(',')[0].split('-')[0].toLowerCase();
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}&accept-language=${encodeURIComponent(lang)}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('geocode http ' + resp.status);
    const arr = await resp.json();
    const first = Array.isArray(arr) ? arr[0] : null;
    const res = first ? { lat: parseFloat(first.lat), lon: parseFloat(first.lon) } : { lat: NaN, lon: NaN };
    _geocodeCache.set(key, res);
    try { localStorage.setItem('geo:'+key, JSON.stringify(res)); } catch {}
    return res;
  } finally {
    _pending = Math.max(0, _pending - 1);
  }
}

// Маршрут через OSRM (без ключей)
async function _routeBetween(a, b) {
  const url = `https://router.project-osrm.org/route/v1/driving/${a.lon},${a.lat};${b.lon},${b.lat}?overview=full&geometries=geojson&alternatives=false&steps=false`;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const data = await r.json();
    return data?.routes?.[0] || null;
  } catch {
    return null;
  }
}

function _toast(text) {
  try {
    if (window.showToast) return window.showToast(text);
    alert(text);
  } catch {}
}

// Вспомогательная: открыть маршрут по id заявки (если она в window.announcements)
export async function openRouteOnMapForRequestId(id) {
  try {
    const list = Array.isArray(window.announcements) ? window.announcements : [];
    const req = list.find(r => String(r.id) === String(id) || String(r.request_id) === String(id));
    if (req) return openRouteOnMapForRequest(req);
  } catch {}
  _toast('Заявка не найдена');
}

// ——— Один раз подпишемся: если пользователь явным кликом открывает «Карту» — покажем обзор
if (!window.__bindMapsNavToOverview) {
  document.addEventListener('click', (e) => {
    const btn = e.target.closest(
      '#btn-maps, [data-section="maps"], [data-target="maps"], a[href="#maps"], button[aria-controls="page-maps"]'
    );
    if (btn) {
      window.__forceOverviewOnce = true; // на следующий showMapsSection() отрисуем обзор
    }
  }, true); // capture: чтобы сработать раньше роутера
  window.__bindMapsNavToOverview = true;
}
