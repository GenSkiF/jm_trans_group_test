// frontend/js/services/universal-search.js
// Универсальный автосерч: attachUniversalSearch(inputEl, { onSelect, endpoint, minLength })
export function attachUniversalSearch(inputEl, opts = {}) {
  // 1) пробуем same-origin (если есть прокси /autocomplete_geo на том же домене/порте)
  // 2) fallback — прямой доступ к HTTP-сервису (порт/хост можно задать в localStorage)
  const DEFAULT_ENDPOINT_SAME_ORIGIN = "/autocomplete_geo";
  const GEO_HOST = localStorage.getItem('geo_host') || location.hostname;
  const GEO_PORT = localStorage.getItem('geo_port') || '9101'; // если у вас 9000 — просто setItem('geo_port','9000')
  const DEFAULT_ENDPOINT_DIRECT = `${location.protocol}//${GEO_HOST}:${GEO_PORT}/autocomplete_geo`;
  const endpoint = opts.endpoint || DEFAULT_ENDPOINT_SAME_ORIGIN;

  // Режимы работы автоподсказки
  const GEO_MODE = (localStorage.getItem('geo_mode') || '').toLowerCase();
  // Принудительно использовать Nominatim, если просили:
  //  - attachUniversalSearch(..., { endpoint: 'nominatim' })
  //  - или localStorage.setItem('geo_mode','nominatim')
  const FORCE_NOMINATIM = (String(opts.endpoint).toLowerCase() === 'nominatim') || (GEO_MODE === 'nominatim');

  // --- Language detection (dynamic Accept-Language) ---
  function detectLang(q) {
    // 1) explicit lang via opts.lang
    if (opts.lang && typeof opts.lang === 'string') {
      return opts.lang.split(',')[0].split('-')[0].toLowerCase();
    }
    // 2) per-input heuristic by script
    if (/[\u10A0-\u10FF]/.test(q)) return 'ka'; // Georgian
    if (/[А-Яа-яЁё]/.test(q)) return 'ru';       // Cyrillic
    // 3) from UI or browser
    const ui = (localStorage.getItem('ui_lang') || document.documentElement.lang || navigator.language || 'en');
    return ui.split(',')[0].split('-')[0].toLowerCase();
  }

  // === Recents (Недавние) ===
  const RECENTS_KEY = 'geo_recents_v2';

  function loadRecents() {
    try { return JSON.parse(localStorage.getItem(RECENTS_KEY) || '[]') } catch { return []; }
  }
  function saveRecents(list) {
    try { localStorage.setItem(RECENTS_KEY, JSON.stringify((list || []).slice(0, 20))); } catch {}
  }
  function updateRecents(item) {
    const list = loadRecents();
    const key  = (String(item.label) + '|' + String(item.country_code||'')).toLowerCase();
    const idx  = list.findIndex(x => (String(x.label) + '|' + String(x.country_code||'')).toLowerCase() === key);
    if (idx >= 0) list.splice(idx, 1);
    list.unshift({
      label: item.label,
      country_code: item.country_code || '',
      lat: item.lat, lon: item.lon,
      synonyms: Array.isArray(item.synonyms) ? item.synonyms : []
    });
    saveRecents(list);
  }
  function searchRecents(q) {
    const s = String(q || '').toLowerCase();
    const list = loadRecents();
    return list.filter(r => {
      if (String(r.label || '').toLowerCase().startsWith(s)) return true;
      return Array.isArray(r.synonyms) && r.synonyms.some(v => String(v).toLowerCase().startsWith(s));
    });
  }


  const minLength = Number.isFinite(opts.minLength) ? opts.minLength : 2;
  const onSelect = typeof opts.onSelect === "function" ? opts.onSelect : () => {};

  // контейнер подсказок
  const suggest = document.createElement("div");
  suggest.className = "uni-suggest";
  Object.assign(suggest.style, {
    position: "absolute",
    zIndex: 99999,
    display: "none",
    background: "#fff",
    borderRadius: "10px",
    boxShadow: "0 10px 30px rgba(0,0,0,.12)",
    border: "1px solid #e9e9ee",
    maxHeight: "300px",
    overflowY: "auto",
    fontSize: "14px"
  });

  // обёртка для позиционирования (если нет — используем body)
  const wrapper = getWrapper(inputEl);
  wrapper.appendChild(suggest);

  let timer = null;
  let items = [];
  let active = -1;

  function placeSuggest() {
    const r = inputEl.getBoundingClientRect();
    const wr = wrapper.getBoundingClientRect();
    const top = r.bottom - wr.top + (wrapper === document.body ? window.scrollY : 0);
    const left = r.left - wr.left + (wrapper === document.body ? window.scrollX : 0);
    suggest.style.top = `${top + 6}px`;
    suggest.style.left = `${left}px`;
    suggest.style.minWidth = `${r.width}px`;
  }

  function hideSuggest() {
    suggest.style.display = "none";
    suggest.innerHTML = "";
    items = [];
    active = -1;
  }

  function render(list) {
    items = list || [];
    active = -1;
    if (!items.length) return hideSuggest();

    const html = items.map((it, i) => {
      const cc = String(it.country_code || "").toLowerCase();
      const flag = cc ? `<span class="fi fi-${cc}" style="margin-right:8px"></span>` : "";
      return `
        <div class="uni-suggest-item" data-idx="${i}" style="display:flex;align-items:center;gap:8px;padding:8px 10px;cursor:pointer">
          ${flag}
          <span>${escapeHtml(it.label || "")}</span>
        </div>
      `;
    }).join("");

    suggest.innerHTML = html;
    suggest.style.display = "block";
    placeSuggest();
  }

  function choose(idx) {
    if (idx < 0 || idx >= items.length) return;
    const it = items[idx];
    inputEl.value = it.label || it.display_name || "";
    hideSuggest();

    const lat = Number(it.lat);
    const lon = Number(it.lon);
    updateRecents(it);
    onSelect({
      label: inputEl.value,
      lat: Number.isFinite(lat) ? lat : undefined,
      lon: Number.isFinite(lon) ? lon : undefined,
      type: it.type || "place",
      country_code: it.country_code || ""
    });
  }

  async function onInput() {
    const q = inputEl.value.trim();
    clearTimeout(timer);
    if (q.length < minLength) { hideSuggest(); return; }
    // Сначала попробуем «Недавние»
    const recent = searchRecents(q);
    if (recent.length) {
      // Рисуем предварительно (без сетевого запроса), флаг и чистое имя уже есть
      render(recent);
    }

    timer = setTimeout(async () => {
      try {
        let arr = [];
        // Если включили режим Nominatim — не трогаем локальные эндпоинты вообще
        if (FORCE_NOMINATIM) {
          try {
            const nomi = await fetch(
              `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&namedetails=1&limit=8&q=${encodeURIComponent(q)}&accept-language=${encodeURIComponent(detectLang(q))}`,
              { cache: 'no-cache' }
            );
            let rows = [];
            if (nomi.ok) rows = await nomi.json();
            const lang = detectLang(q);
            const mapNominatimRow = (row) => {
              const a  = row.address || {};
              const nd = row.namedetails || {};
              // 1) берём имя на языке интерфейса/ввода
              const byLang =
                nd[`name:${lang}`] || nd[lang] || nd.name || null;
              // 2) city-like из address
              const cityLike =
                a.city || a.town || a.village || a.municipality || null;
              // 3) первая часть display_name до запятой
              const first = String(row.display_name || '').split(',')[0].trim() || null;
              // Итоговая метка — ТОЛЬКО имя населённого пункта
              const label = byLang || cityLike || first || q;
              // Синонимы для «Недавних»
              const synonyms = Object
                .keys(nd || {})
                .filter(k => k.startsWith('name:'))
                .map(k => nd[k])
                .filter(Boolean);
              return {
                label,
                display_name: row.display_name,
                lat: row.lat, lon: row.lon,
                type: row.type,
                country_code: (a.country_code || '').toLowerCase(),
                synonyms
              };
            };
            arr = rows.map(mapNominatimRow);

          } catch {}
        } else {
          // 1) same-origin
          try {
            const lang = detectLang(q);
            const url = `${endpoint}?q=${encodeURIComponent(q)}&lang=${encodeURIComponent(lang)}`;
            const res = await fetch(url, { cache: 'no-cache' });
            if (res.ok) arr = await res.json();
          } catch {}
          // 2) direct (если same-origin нет)
          if ((!arr || !arr.length) && endpoint === DEFAULT_ENDPOINT_SAME_ORIGIN) {
            try {
              const lang = detectLang(q);
              const direct = `${DEFAULT_ENDPOINT_DIRECT}?q=${encodeURIComponent(q)}&lang=${encodeURIComponent(lang)}`;
              const res2 = await fetch(direct, { cache: 'no-cache' });
              if (res2.ok) arr = await res2.json();
            } catch {}
          }
          // 3) резервный Nominatim
          if (!arr || !arr.length) {
            try {
              const nomi = await fetch(
                `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&namedetails=1&limit=8&q=${encodeURIComponent(q)}&accept-language=${encodeURIComponent(detectLang(q))}`,
                { cache: 'no-cache' }
              );
              if (nomi.ok) {
                const rows = await nomi.json();
                arr = rows.map(r => ({
                  label: r.display_name,
                  display_name: r.display_name,
                  lat: r.lat, lon: r.lon,
                  type: r.type,
                  country_code: (r.address && r.address.country_code) || ''
                }));
              }
            } catch {}
          }
        }

        // Объединим: recent (в приоритете) + arr (удалим дубли по label|country)
        const out = [];
        const seen = new Set();
        (recent || []).concat(arr || []).forEach(it => {
          const key = (String(it.label || '').toLowerCase() + '|' + String(it.country_code || '')).toLowerCase();
          if (key && !seen.has(key)) { seen.add(key); out.push(it); }
        });

        render(out);
      } catch {
        hideSuggest();
      }
    }, 160);
  }

  function onKeyDown(e) {
    if (suggest.style.display === "none") return;
    if (e.key === "ArrowDown") {
      e.preventDefault(); active = Math.min(active + 1, items.length - 1); highlight(active);
    } else if (e.key === "ArrowUp") {
      e.preventDefault(); active = Math.max(active - 1, 0); highlight(active);
    } else if (e.key === "Enter") {
      e.preventDefault(); if (active >= 0) choose(active);
    } else if (e.key === "Escape") {
      hideSuggest();
    }
  }

  function highlight(idx) {
    [...suggest.querySelectorAll('.uni-suggest-item')].forEach((el, i) => {
      el.style.background = i === idx ? '#f3f4f6' : '';
    });
  }

  function onBlur() { setTimeout(hideSuggest, 150); }
  function onClickSuggest(e) {
    const item = e.target.closest('.uni-suggest-item');
    if (!item) return;
    const idx = Number(item.getAttribute('data-idx') || -1);
    if (idx >= 0) choose(idx);
  }

  inputEl.addEventListener("input", onInput);
  inputEl.addEventListener("keydown", onKeyDown);
  inputEl.addEventListener("blur", onBlur);
  suggest.addEventListener("mousedown", onClickSuggest);

  // внешний API
  return {
    destroy() {
      clearTimeout(timer);
      inputEl.removeEventListener("input", onInput);
      inputEl.removeEventListener("keydown", onKeyDown);
      inputEl.removeEventListener("blur", onBlur);
      suggest.removeEventListener("mousedown", onClickSuggest);
      suggest.remove();
    }
  };

}

// ——— helpers ———
function getWrapper(inputEl) {
  let parent = inputEl.closest('.position-relative');
  if (!parent) parent = inputEl.parentElement;
  if (!parent) parent = document.body;
  return parent;
}
function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
