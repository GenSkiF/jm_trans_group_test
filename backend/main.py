import asyncio
import sys
import os
from threading import Thread

from backend.core.database import init_db
from backend.services.autocomplete import run_autocomplete_server
from backend.services.websocket_server import main as ws_main

# === Инициализация БД (создает таблицы если их нет) ===
try:
    init_db()
except Exception as e:
    print(f"[FATAL] init_db failed: {e}")
    sys.exit(1)

print("Current working directory:", os.getcwd())
try:
    print("Files in config dir:", os.listdir("backend/config"))
except Exception:
    pass

def run_flask():
    """Поднимаем Flask-сервис автокомплита/карты на :9101 (без перезапуска)."""
    try:
        run_autocomplete_server()  # блокирующий .run()
    except Exception as e:
        print(f"Flask server error: {e}")
        sys.exit(1)

def run_websocket():
    """Поднимаем WebSocket-сервер на :8766."""
    try:
        asyncio.run(ws_main())
    except Exception as e:
        print(f"WebSocket server error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    flask_thread = Thread(target=run_flask, daemon=True)
    flask_thread.start()
    run_websocket()
