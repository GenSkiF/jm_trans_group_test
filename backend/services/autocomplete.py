# backend/services/autocomplete.py — МНОГОЯЗЫЧНЫЙ АВТОКОМПЛИТ + КАРТА
from __future__ import annotations
import json
import re
import requests
from pathlib import Path
from typing import Dict, List, Tuple, Optional
from flask import Flask, request, jsonify, send_from_directory, Response

APP_PORT = 9101  # ⬅️ СТАВИМ 9101, чтобы открываться по http://192.168.0.101:9101


def search_cities(q: str, limit: int = 8, lang_hint: Optional[str] = None) -> List[dict]:
    """
    Чистый прокси к Nominatim (без локального JSON).
    Возвращает список в формате [{label, country_code, type}]
    """
    q = (q or "").strip()
    if not q:
        return []

    # Язык для подписей: берем из ?lang=..., иначе из Accept-Language браузера (если прокинут),
    # иначе не навязываем — используем 'en' как безопасный дефолт.
    lang = (lang_hint or request.headers.get('Accept-Language') or 'en').split(',')[0].split('-')[0].lower()

    try:
        r = requests.get(
            "https://nominatim.openstreetmap.org/search",
            params={
                "format": "jsonv2",
                "addressdetails": 1,
                "limit": int(limit or 8),
                "q": q,
                "accept-language": lang,   # ← как вы просили
            },
            headers={
                "Accept-Language": lang,
                "User-Agent": "jm-autocomplete/1.0"
            },
            timeout=6
        )
        rows = r.json() if r.ok else []
    except Exception:
        rows = []

    results: List[dict] = []
    seen = set()
    for it in rows:
        label = (it.get("display_name") or "").strip()
        code  = (((it.get("address") or {}).get("country_code")) or "").upper()
        typ   = (it.get("type") or "city")
        if not label:
            continue
        key = (label.lower(), code)
        if key in seen:
            continue
        seen.add(key)
        results.append({
            "label": label,
            "country_code": code,
            "type": typ
        })
        if len(results) >= int(limit or 8):
            break

    return results


# ── Flask app ─────────────────────────────────────────────────────────────────
def create_app() -> Flask:
    app = Flask(__name__, static_folder=str(FRONTEND_DIR), static_url_path="/frontend")

    @app.get("/healthz")
    def healthz(): return "ok", 200

    @app.after_request
    def add_cors_headers(resp):
        resp.headers["Access-Control-Allow-Origin"]  = "*"
        resp.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
        resp.headers["Access-Control-Allow-Methods"] = "GET, OPTIONS"
        return resp

    # Корень: отдаём фронт
    @app.get("/")
    def root_index():
        return send_from_directory(str(FRONTEND_DIR), "index.html")

    # Автокомплит
    @app.route("/autocomplete_geo", methods=["GET", "OPTIONS"])
    def autocomplete_geo():
        if request.method == "OPTIONS":
            return ("", 204)
        q     = request.args.get("q", "", type=str)
        limit = request.args.get("limit", 8, type=int)
        lang  = request.args.get("lang")  # ← возьмём язык из запроса, если передали
        return jsonify(search_cities(q, limit, lang_hint=lang))

    # Раздача фронта
    @app.get("/frontend/")
    def frontend_index():
        return send_from_directory(str(FRONTEND_DIR), "index.html")

    @app.get("/frontend/<path:filename>")
    def frontend_files(filename):
        return send_from_directory(str(FRONTEND_DIR), filename)

    # Карта: умный фолбэк между двумя версиями
    CDN_LEAFLET_JS  = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"
    CDN_LEAFLET_CSS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"

    def _load_map_file(path: Path) -> Optional[str]:
        if not path.exists(): return None
        try:
            html = path.read_text(encoding="utf-8")
        except Exception:
            return None
        # если в файле ссылались на локальные leaflet/* — заменим на CDN
        html = html.replace('leaflet/leaflet.js', CDN_LEAFLET_JS)
        html = html.replace('leaflet/leaflet.css', CDN_LEAFLET_CSS)
        return html

    @app.get("/map.html")
    def map_html():
        # приоритет: backend/static/map.html → backend/static/map_gen.html → фронтовый map.html → inline fallback
        for candidate in (STATIC_DIR / "map.html", STATIC_DIR / "map_gen.html", FRONTEND_DIR / "map.html"):
            html = _load_map_file(candidate)
            if html:
                return Response(html, mimetype="text/html; charset=utf-8")

        # Фолбэк-страница (всегда рабочая, с CDN)
        fallback = f"""<!doctype html><html><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Map</title>
<link rel="stylesheet" href="{CDN_LEAFLET_CSS}">
<style>html,body,#map{{height:100%;margin:0}}</style></head>
<body><div id="map"></div>
<script src="{CDN_LEAFLET_JS}"></script>
<script>
const map=L.map('map'); map.setView([41.716,44.78],7);
L.tileLayer('https://{{s}}.tile.openstreetmap.org/{{z}}/{{x}}/{{y}}.png',{{maxZoom:19}}).addTo(map);
window.addEventListener('message',ev=>{{ const d=(ev&&ev.data)||{{}}; if(d.type==='map:add_marker'&&d.payload){{ const p=d.payload; if(p.lat&&p.lon){{ const m=L.marker([p.lat,p.lon]).addTo(map); m.bindPopup((p.name||'')+'<br>'+p.lat+', '+p.lon).openPopup(); map.setView([p.lat,p.lon],13); }}}}}});
</script></body></html>"""
        return Response(fallback, mimetype="text/html; charset=utf-8")

    # Демо-данные для карты (оставил как у тебя)
    @app.get("/map/data")
    def map_data():
        return jsonify({"features": []})

    return app

def run_autocomplete_server():
    app = create_app()
    app.run(host="0.0.0.0", port=APP_PORT, debug=False, use_reloader=False)
