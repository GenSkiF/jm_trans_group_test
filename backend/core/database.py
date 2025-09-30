import psycopg2
import psycopg2.extras
import logging
import json
import os
import bcrypt

CONFIG_PATH = os.path.join(os.path.dirname(__file__), "../config/config.json")
with open(CONFIG_PATH, "r", encoding="utf-8") as f:
    DB_CONFIG = json.load(f)

# --- Normalization helpers ---
def normalize_request_status(value: str|None) -> str:
    """Map arbitrary localized status string to canonical code.
    Allowed: priority|active|current|closed|done
    Fallback: 'active'
    """
    if not value:
        return 'active'
    s = str(value).strip().lower()
    # direct codes
    if s in ('priority','active','current','closed','done'):
        return s
    # heuristics by substrings (ru/ka/en)
    if any(x in s for x in ('prior','приор','პრიო')):
        return 'priority'
    if any(x in s for x in ('current','текущ','მიმდინ')):
        return 'current'
    if any(x in s for x in ('closed','закрыт','დახურულ','დახურ','დახურული')):
        return 'closed'
    if any(x in s for x in ('done','cancel','отмен','გაუქმ')):
        return 'done'
    if any(x in s for x in ('active','актив','აქტიური','აქტიურს')):
        return 'active'
    # default
    return 'active'


def normalize_vehicle_number(value: str|None) -> str:
    """Normalize vehicle/plate number for stable deduplication."""
    s = (value or '').strip()
    # collapse inner whitespace to single space
    s = ' '.join(s.split())
    # upper
    s = s.upper()
    return s    


def get_conn():
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        conn.cursor().execute("SELECT 1")  # Проверка подключения
        return conn
    except Exception as e:
        logging.error(f"Database connection error: {e}")
        raise
# Инициализация таблиц


def init_db():
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS requests (
                    id SERIAL PRIMARY KEY,
                    data JSONB NOT NULL
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS users (
                    id SERIAL PRIMARY KEY,
                    username TEXT UNIQUE NOT NULL,
                    password TEXT NOT NULL,
                    role TEXT NOT NULL
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS app_settings (
                    key TEXT PRIMARY KEY,
                    value TEXT
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS vehicle_statuses (
                    id SERIAL PRIMARY KEY,
                    request_id INTEGER NOT NULL,
                    vehicle_number TEXT NOT NULL,
                    load_date DATE,
                    status_text TEXT,
                    status_date DATE,
                    unloaded BOOLEAN NOT NULL DEFAULT FALSE,
                    unload_date DATE,
                    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                    last_updated TIMESTAMP NOT NULL DEFAULT NOW()
                )
            """)
            cur.execute("""
                CREATE UNIQUE INDEX IF NOT EXISTS ux_vehicle_statuses_req_vehicle
                ON vehicle_statuses (request_id, vehicle_number)
            """)
            # 👇 Миграции «на лету»: добавим недостающие колонки, если таблица старая
            cur.execute("ALTER TABLE vehicle_statuses ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW()")
            cur.execute("ALTER TABLE vehicle_statuses ADD COLUMN IF NOT EXISTS last_updated TIMESTAMP NOT NULL DEFAULT NOW()")
            cur.execute("ALTER TABLE vehicle_statuses ADD COLUMN IF NOT EXISTS status_text TEXT")
            cur.execute("ALTER TABLE vehicle_statuses ADD COLUMN IF NOT EXISTS status_date DATE")
            cur.execute("ALTER TABLE vehicle_statuses ADD COLUMN IF NOT EXISTS unloaded BOOLEAN NOT NULL DEFAULT FALSE")
            cur.execute("ALTER TABLE vehicle_statuses ADD COLUMN IF NOT EXISTS unload_date DATE")
        conn.commit()

def check_tables():
    """Проверяет существование всех необходимых таблиц в БД"""
    tables = ["requests", "users", "app_settings"]
    with get_conn() as conn:
        with conn.cursor() as cur:
            for table in tables:
                cur.execute(
                    "SELECT EXISTS (SELECT FROM pg_tables WHERE tablename = %s)",
                    (table,)
                )
                exists = cur.fetchone()[0]
                print(f"Таблица '{table}' существует:", exists)
                if not exists:
                    print(f"⚠️ Таблица '{table}' отсутствует в БД!")
                    return False
    return True

# Загрузить все заявки


def load_all_requests():
    try:
        with get_conn() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute("SELECT id, data FROM requests ORDER BY id")
                result = []
                for row in cur.fetchall():
                    row_data = dict(row['data']) if row['data'] else {}
                    row_data['id'] = row['id']
                    result.append(row_data)
                return result
    except Exception as e:
        logging.error(f"[database] Ошибка при чтении всех заявок: {e}")
        return []

# Сохранить заявку в БД


def save_request_to_db(new_request: dict):
    try:
        new_request = dict(new_request)  # копия

        # normalize status
        if 'status' in new_request:
            new_request['status'] = normalize_request_status(new_request.get('status'))

        # ► НОРМАЛИЗУЕМ ID НАДЁЖНО
        raw_id = new_request.get("id")
        norm_id = None
        if isinstance(raw_id, int):
            norm_id = raw_id
        elif isinstance(raw_id, str):
            s = raw_id.strip()
            if s.isdigit():
                norm_id = int(s)

        if norm_id is not None:
            new_request["id"] = norm_id  # держим int и в JSON, и в БД
        else:
            # Не пускаем пустой/битый id в UPDATE, чтобы не получить клон через INSERT
            new_request.pop("id", None)

        with get_conn() as conn:
            with conn.cursor() as cur:
                if norm_id is not None:
                    cur.execute("""
                        UPDATE requests SET data=%s WHERE id=%s
                    """, (psycopg2.extras.Json(new_request), norm_id))
                    # Если строки с таким id нет — не делаем INSERT, чтобы не плодить клонов
                    if cur.rowcount == 0:
                        logging.error(f"[database] UPDATE 0 rows for id={norm_id}; запись не найдена — сохранение отменено")
                        conn.rollback()
                        return None
                else:
                    cur.execute("""
                        INSERT INTO requests (data) VALUES (%s) RETURNING id
                    """, (psycopg2.extras.Json(new_request),))
                    new_id = cur.fetchone()[0]
                    new_request["id"] = new_id
            conn.commit()
        return new_request
    except Exception as e:
        logging.error(f"[database] Ошибка при сохранении заявки: {e}")
        return None


def addTask(task_data: dict):
    return save_request_to_db(task_data)


def updateTask(task_data: dict):
    return save_request_to_db(task_data)


def deleteTask(task_id: int):
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM requests WHERE id=%s", (task_id,))
                conn.commit()
        print(f"deleteTask: task_id={task_id} удалена")
        return True
    except Exception as e:
        print(f"deleteTask: error={e}")
        return False

# --- Пользователи ---


def load_all_users():
    try:
        with get_conn() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    "SELECT id, username, password, role FROM users ORDER BY id")
                return cur.fetchall()
    except Exception as e:
        logging.error(f"[database] Ошибка при чтении пользователей: {e}")
        return []


def add_user(username: str, password: str, role: str):
    try:
        # Хэшируем пароль перед сохранением
        password_hash = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO users (username, password, role)
                    VALUES (%s, %s, %s)
                    ON CONFLICT (username) DO NOTHING
                """, (username, password_hash, role))
                conn.commit()
        print(f"add_user: user '{username}' added successfully")
        return True
    except Exception as e:
        print(f"add_user: error={e}")
        return False

def get_user(username: str):
    try:
        with get_conn() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute("""
                    SELECT id, username, password, role FROM users WHERE username = %s
                """, (username,))
                return cur.fetchone()
    except Exception as e:
        print(f"get_user: error={e}")
        return None

# --- Настройки ---

def check_password(plain_password, password_hash):
    # password_hash из базы всегда str, а bcrypt ждёт bytes
    return bcrypt.checkpw(plain_password.encode('utf-8'), password_hash.encode('utf-8'))


def save_setting(key, value):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute('''
                INSERT INTO app_settings (key, value)
                VALUES (%s, %s)
                ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value
            ''', (key, value))
        conn.commit()


def load_setting(key):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                'SELECT value FROM app_settings WHERE key = %s', (key,))
            result = cur.fetchone()
            return result[0] if result else ""


def get_all_settings():
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute('SELECT key, value FROM app_settings')
            return {key: value for key, value in cur.fetchall()}


def get_request_from_db(task_id):
    """
    Получить одну заявку по её id (int или str).
    Возвращает заявку-словарь с данным id, либо None.
    """
    try:
        # Надёжно приводим к int
        if isinstance(task_id, str):
            s = task_id.strip()
            if s.isdigit():
                task_id = int(s)
        elif isinstance(task_id, float):
            task_id = int(task_id)

        with get_conn() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute("SELECT id, data FROM requests WHERE id = %s", (task_id,))
                row = cur.fetchone()
                if row:
                    row_data = dict(row['data']) if row['data'] else {}
                    row_data['id'] = row['id']
                    return row_data
                else:
                    return None
    except Exception as e:
        print(f"get_request_from_db: error={e}")
        return None

# ===== Статусы машин =====
def ensure_vehicle_statuses_table():
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS vehicle_statuses (
                        id SERIAL PRIMARY KEY,
                        request_id INTEGER NOT NULL,
                        vehicle_number TEXT NOT NULL,
                        load_date DATE,
                        status_text TEXT DEFAULT '',
                        status_date DATE,
                        unloaded BOOLEAN NOT NULL DEFAULT FALSE,
                        unload_date DATE,
                        last_updated TIMESTAMP NOT NULL DEFAULT NOW(),
                        UNIQUE (request_id, vehicle_number)
                    );
                """)
                cur.execute("CREATE INDEX IF NOT EXISTS idx_vs_req ON vehicle_statuses(request_id);")
            conn.commit()
    except Exception as e:
        logging.error(f"ensure_vehicle_statuses_table error: {e}")

def list_vehicle_statuses():
    try:
        with get_conn() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute("""
                    SELECT id, request_id, vehicle_number, load_date, status_text, status_date,
                           unloaded, unload_date, created_at, last_updated
                    FROM vehicle_statuses
                    ORDER BY unloaded ASC, last_updated DESC, request_id, vehicle_number
                """)
                return [dict(r) for r in cur.fetchall()]
    except Exception as e:
        logging.error(f"list_vehicle_statuses error: {e}")
        return []

def upsert_vehicle_status(request_id: int, vehicle_number: str, load_date: str|None):
    if not request_id or not vehicle_number:
        return
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO vehicle_statuses (request_id, vehicle_number, load_date)
                    VALUES (%s, %s, %s)
                    ON CONFLICT (request_id, vehicle_number)
                    DO UPDATE SET
                        load_date = COALESCE(EXCLUDED.load_date, vehicle_statuses.load_date),
                        last_updated = NOW()
                """, (request_id, normalize_vehicle_number(vehicle_number), load_date))
            conn.commit()
    except Exception as e:
        logging.error(f"upsert_vehicle_status error: {e}")


def reconcile_statuses_for_request(request_id: int, vehicles: list[str], load_date: str|None):
    """Синхронизировать строки по заявке: добавить недостающие, удалить отсутствующие."""
    try:
        vset = set([ normalize_vehicle_number(v) for v in (vehicles or []) if (v or '').strip() ])
        with get_conn() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                # Текущие
                cur.execute("SELECT vehicle_number FROM vehicle_statuses WHERE request_id=%s", (request_id,))
                current = set([ normalize_vehicle_number(r['vehicle_number']) for r in cur.fetchall() ])

                # Добавить недостающие
                for v in vset - current:
                    cur.execute("""
                        INSERT INTO vehicle_statuses (request_id, vehicle_number, load_date)
                        VALUES (%s, %s, %s)
                        ON CONFLICT (request_id, vehicle_number) DO NOTHING
                    """, (request_id, v, load_date))

                # Удалить лишние
                if current - vset:
                    cur.execute("""
                        DELETE FROM vehicle_statuses
                        WHERE request_id=%s AND vehicle_number = ANY(%s)
                    """, (request_id, list(current - vset)))

            conn.commit()
    except Exception as e:
        logging.error(f"reconcile_statuses_for_request error: {e}")

def reconcile_statuses_from_request(req: dict):
    """
    НОВОЕ: синхронизация vehicle_statuses ПО КАЖДОМУ ВОДИТЕЛЮ.
    Для каждой машины берём ДАТУ ЗАГРУЗКИ ИЗ driver.date (если нет — из первой loading_dates).
    """
    try:
        if not req:
            return
        # request_id приводим к int
        rid = req.get("id")
        if isinstance(rid, str) and rid.strip().isdigit():
            rid = int(rid.strip())
        if not isinstance(rid, int):
            return

        # 1) Собрать: { НОРМ_номер_ТС -> дата_загрузки(DD-MM-YYYY)|None }
        vehicle_to_date: dict[str, str|None] = {}
        # fallback — первая дата из loading_dates (если у конкретного водителя даты нет)
        fallback_date = None
        for ld in (req.get("loading_dates") or []):
            d = (ld.get("date") or ld.get("loading_date") or ld.get("day") or "").strip()
            if d:
                fallback_date = d[:10]
                break

        for d in (req.get("drivers") or []):
            # вытаскиваем номер ТС из любого из поддерживаемых ключей
            v = None
            for key in ("stateNumber", "vehicleNumber", "plate", "carNumber", "number", "tsNumber"):
                vv = d.get(key)
                if vv:
                    v = normalize_vehicle_number(str(vv))
                    break
            if not v:
                continue

            # дата именно ЭТОГО водителя
            drv_date = (d.get("date") or "").strip()
            if drv_date:
                drv_date = drv_date[:10]
            else:
                drv_date = fallback_date

            vehicle_to_date[v] = drv_date  # может быть None

        vset = set(vehicle_to_date.keys())

        with get_conn() as conn:
            with conn.cursor() as cur:
                # текущие номера в таблице — в «сыром» и нормализованном виде
                cur.execute("SELECT vehicle_number FROM vehicle_statuses WHERE request_id=%s", (rid,))
                raw_rows = [ (r[0] or "").strip() for r in cur.fetchall() ]
                current_norm = set([ normalize_vehicle_number(x) for x in raw_rows ])

                # Добавить/обновить недостающие — с ПЕРСОНАЛЬНОЙ датой
                for v in vset:
                    cur.execute("""
                        INSERT INTO vehicle_statuses (request_id, vehicle_number, load_date)
                        VALUES (%s, %s, %s)
                        ON CONFLICT (request_id, vehicle_number)
                        DO UPDATE SET
                            load_date    = COALESCE(EXCLUDED.load_date, vehicle_statuses.load_date),
                            last_updated = NOW()
                    """, (rid, v, vehicle_to_date.get(v)))

                # Удалить «лишние» строки, чей нормализованный номер не входит в vset
                extra_raw = [ raw for raw in raw_rows if normalize_vehicle_number(raw) not in vset ]
                if extra_raw:
                    cur.execute(
                        "DELETE FROM vehicle_statuses WHERE request_id=%s AND vehicle_number = ANY(%s)",
                        (rid, extra_raw)
                    )

            conn.commit()
    except Exception as e:
        logging.error(f"reconcile_statuses_from_request error: {e}")


def set_vehicle_status_text(request_id: int, vehicle_number: str, text: str|None):
    try:
        # ensure row exists and normalize vehicle_number
        vehicle_number = normalize_vehicle_number(vehicle_number)
        try:
            upsert_vehicle_status(request_id, vehicle_number, None)
        except Exception:
            pass
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    UPDATE vehicle_statuses
                       SET status_text = %s,
                           status_date = CURRENT_DATE,
                           last_updated = NOW()
                     WHERE request_id=%s AND vehicle_number=%s
                """, (text or '', request_id, (vehicle_number or '').strip()))
            conn.commit()
    except Exception as e:
        logging.error(f"set_vehicle_status_text error: {e}")

def clear_daily_status_texts():
    """В 00:00 очищаем поле status_text для НЕ выгруженных машин за прошлые дни."""
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    UPDATE vehicle_statuses
                       SET status_text = '',
                           status_date  = NULL,
                           last_updated = NOW()
                     WHERE unloaded = FALSE
                       AND status_date IS NOT NULL
                       AND status_date < CURRENT_DATE
                """)
            conn.commit()
    except Exception as e:
        logging.error(f"clear_daily_status_texts error: {e}")


def cleanup_unloaded_rows_older_than_48h():
    """Удаляем КАЖДУЮ строку, если по ней стоит галочка и прошло 48ч с даты выгрузки."""
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    DELETE FROM vehicle_statuses
                     WHERE unloaded = TRUE
                       AND unload_date IS NOT NULL
                       AND unload_date < CURRENT_DATE - INTERVAL '2 days'
                """)
            conn.commit()
    except Exception as e:
        logging.error(f"cleanup_unloaded_rows_older_than_48h error: {e}")


def toggle_vehicle_unloaded(request_id: int, vehicle_number: str, unloaded: bool|None, unload_date: str|None):
    """Если unloaded is None — меняем только дату."""
    try:
        # ensure row exists and normalize vehicle_number
        vehicle_number = normalize_vehicle_number(vehicle_number)
        try:
            upsert_vehicle_status(request_id, vehicle_number, None)
        except Exception:
            pass
        with get_conn() as conn:
            with conn.cursor() as cur:
                if unloaded is None:
                    cur.execute("""
                        UPDATE vehicle_statuses
                           SET unload_date = %s,
                               last_updated = NOW()
                         WHERE request_id=%s AND vehicle_number=%s
                    """, (unload_date, request_id, (vehicle_number or '').strip()))
                else:
                    cur.execute("""
                        UPDATE vehicle_statuses
                           SET unloaded = %s,
                               unload_date = %s,
                               last_updated = NOW()
                         WHERE request_id=%s AND vehicle_number=%s
                    """, (bool(unloaded), unload_date, request_id, (vehicle_number or '').strip()))
            conn.commit()
    except Exception as e:
        logging.error(f"toggle_vehicle_unloaded error: {e}")

def all_unloaded_for_request(request_id: int) -> bool:
    """Возвращает True, если ДЛЯ ВСЕХ МАШИН ИЗ ЗАЯВКИ стоит признак unloaded=TRUE.
    Сравнение ведём по НОРМАЛИЗОВАННЫМ номерам, чтобы игнорировать дубликаты/формат."""
    try:
        # 1) Собираем нормализованные номера из заявки
        req = get_request_from_db(request_id)
        if not req:
            return False
        expected = set()
        for d in (req.get("drivers") or []):
            v = None
            for key in ("stateNumber","vehicleNumber","plate","carNumber","number","tsNumber"):
                vv = d.get(key)
                if vv:
                    v = normalize_vehicle_number(str(vv))
                    break
            if v:
                expected.add(v)
        if not expected:
            return False
        # 2) Берём все записи по заявке и сводим по нормализованному номеру
        actual_unloaded = {}
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT vehicle_number, unloaded FROM vehicle_statuses WHERE request_id=%s",
                    (request_id,)
                )
                for veh, un in cur.fetchall():
                    norm = normalize_vehicle_number(veh)
                    actual_unloaded[norm] = actual_unloaded.get(norm, False) or bool(un)
        # 3) Для каждой ожидаемой машины должен быть True
        for v in expected:
            if not actual_unloaded.get(v, False):
                return False
        return True
    except Exception as e:
        logging.error(f"all_unloaded_for_request error: {e}")
        return False

def set_request_status_closed(request_id: int):
    """Помечаем заявку закрытой в таблице requests.data (JSON)."""
    try:
        req = get_request_from_db(request_id)
        if not req:
            return
        data = dict(req)
        # ПИШЕМ КЛЮЧ 'closed' (с ним работают фильтры/цвета/сортировки на фронте)
        data['status'] = 'closed'
        save_request_to_db(data)
    except Exception as e:
        logging.error(f"set_request_status_closed error: {e}")

def reset_daily_status_texts_if_needed():
    """Сбрасываем текст статусов раз в сутки (в 00:00)."""
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                # Сбрасываем всем, у кого дата статуса не сегодня
                cur.execute("""
                    UPDATE vehicle_statuses
                       SET status_text = '',
                           status_date = NULL,
                           last_updated = NOW()
                     WHERE status_date IS DISTINCT FROM CURRENT_DATE
                """)
            conn.commit()
    except Exception as e:
        logging.error(f"reset_daily_status_texts_if_needed error: {e}")

def cleanup_completed_older_than_48h():
    """Удаляем группы строк по заявке, если все выгружены и прошло 48ч от последней выгрузки."""
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    DELETE FROM vehicle_statuses vs
                     WHERE vs.request_id IN (
                        SELECT t.request_id
                          FROM (
                            SELECT request_id,
                                   BOOL_AND(unloaded) AS all_unloaded,
                                   MAX(COALESCE(unload_date, CURRENT_DATE)) AS last_unload_date
                              FROM vehicle_statuses
                             GROUP BY request_id
                          ) t
                         WHERE t.all_unloaded = TRUE
                           AND t.last_unload_date < CURRENT_DATE - INTERVAL '2 days'
                     )
                """)
            conn.commit()
    except Exception as e:
        logging.error(f"cleanup_completed_older_than_48h error: {e}")
