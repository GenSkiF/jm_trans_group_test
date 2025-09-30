import json
import os
import base64
import asyncio
import websockets
import traceback
import logging
import time  # модуль времени (оставляем как модуль!)
from backend.core.database import (
    load_all_requests,
    save_request_to_db,
    add_user,
    get_user,
    deleteTask,
    init_db,
    get_request_from_db,
    check_password,
    list_vehicle_statuses,
    reconcile_statuses_for_request,
    reconcile_statuses_from_request,
    set_vehicle_status_text,
    toggle_vehicle_unloaded,
    all_unloaded_for_request,
    set_request_status_closed,
    clear_daily_status_texts,
    cleanup_unloaded_rows_older_than_48h
)
from backend.core.log_config import setup_logging
from pathlib import Path
import datetime as dt  # модуль datetime под коротким именем
from decimal import Decimal
import uuid  # вверху файла, если ещё нет
import datetime
session_token = str(uuid.uuid4())

setup_logging()
init_db()

ATTACH_DIR = Path(__file__).parent.parent.parent / "attachments"

connected_clients = set()

def _json_default(o):
    """
    Безопасная сериализация для json.dumps:
    - date/datetime/time -> ISO-строки
    - Decimal -> float
    - всё прочее -> str (как крайняя мера)
    """
    if isinstance(o, (dt.datetime, dt.date, dt.time)):
        return o.isoformat()
    if isinstance(o, Decimal):
        return float(o)
    try:
        return str(o)
    except Exception:
        return None

def _json_dumps_safe(message: dict) -> str:
    # ensure_ascii=False — чтобы грузинский/русский текст не превращался в \uXXXX
    return json.dumps(message, default=_json_default, ensure_ascii=False)

print("🟢 Сервер JM Trans Group запущен на порту 8766")
logging.info("🟢 Сервер JM Trans Group запущен на порту 8766")


async def broadcast(message, exclude_ws=None):
    data = _json_dumps_safe(message)
    for client in list(connected_clients):
        if client is exclude_ws:
            continue
        try:
            # пропускаем уже закрытые соединения
            if getattr(client, "closed", False):
                connected_clients.discard(client)
                continue
            await client.send(data)
        except Exception as e:
            logging.error(f"Ошибка отправки клиенту: {e}")
            try:
                await client.close()
            except Exception:
                pass
            connected_clients.discard(client)


async def handle_client(websocket):
    ip, port = websocket.remote_address
    logging.info(
        f"🟢 კლიენტი შეერთებულია — IP: {ip}, Port: {port}")
    connected_clients.add(websocket)

    try:
        async for message in websocket:
            try:
                data = json.loads(message)
                action = data.get("action")
                print("[SERVER] ⏱ ПОЛУЧЕНО ОТ КЛИЕНТА:", time.time(), action)
                print(f"[SERVER RECEIVE] action={action} | data={data}")
                logging.info(f"[SERVER RECEIVE] action={action} | data={data}")

                if action == "ping":
                    await websocket.send(json.dumps({"action": "pong"}))

                elif action == "server_status":
                    await websocket.send(json.dumps({"action": "server_status", "status": "running"}))

                elif action == "add_request":
                    request_data = data.get("data")
                    if request_data:
                        try:
                            t0 = time.time()
                            print(f"[SERVER] [add_request] start: {t0:.6f}")

                            saved = save_request_to_db(request_data)  # ← ВАЖНО: получить объект С УЖЕ ВЫДАННЫМ id
                            if not saved or not saved.get("id"):
                                raise RuntimeError("save_request_to_db returned no id")

                            t1 = time.time()
                            print(f"[SERVER] [add_request] после save_request_to_db: {t1:.6f} (+{t1 - t0:.4f}s)")

                            # Отправляем инициатору и вещаем остальным уже сохранённую заявку
                            await websocket.send(json.dumps({
                                "action": "new_request",
                                "status": "success",
                                "data": saved,
                                "message": "✅ განაცხადი წარმატებით დაემატა"
                            }))
                            await broadcast({"action": "new_request", "data": saved}, exclude_ws=websocket)
                            # >>> STATUSES: reconcile and broadcast (ПО КАЖДОМУ ВОДИТЕЛЮ)
                            try:
                                req_for_status = saved or request_data or {}
                                reconcile_statuses_from_request(req_for_status)
                                rows = list_vehicle_statuses()
                                await broadcast({"action": "statuses_sync", "data": rows})
                                logging.info(f"[statuses] reconcile_from_request id={req_for_status.get('id')}")
                            except Exception:
                                logging.exception("[statuses] reconcile after add_request failed")


                            t2 = time.time()
                            print(f"[SERVER] [add_request] после websocket.send: {t2:.6f} (+{t2 - t1:.4f}s, от начала: +{t2 - t0:.4f}s)")
                        except Exception as e:
                            logging.error(f"Ошибка добавления заявки: {e}")
                            await websocket.send(json.dumps({
                                "action": "new_request",
                                "status": "error",
                                "message": "❌ განაცხადის დამატების შეცდომა"
                            }))

                elif action == "edit_request":
                    request_id = data.get("id")
                    new_data   = (data.get("data") or {})  # dict или {}
                    editor = (
                        (new_data or {}).get("last_editor")
                        or data.get("last_editor")
                        or data.get("editor")
                    )

                    if request_id and isinstance(new_data, dict) and new_data:
                        try:
                            # Всегда приводим request_id к int
                            try:
                                rid = int(str(request_id).strip())
                            except Exception:
                                await websocket.send(json.dumps({
                                    "action": "edit_request",
                                    "status": "fail",
                                    "message": "Некорректный id заявки"
                                }))
                                return

                            req = get_request_from_db(rid)
                            if not req:
                                await websocket.send(json.dumps({
                                    "action": "edit_request",
                                    "status": "fail",
                                    "message": "Заявка не найдена"
                                }))
                                return

                            # ✅ ЖЁСТКО сохраняем id и не даём его перезаписать
                            new_data.pop("id", None)
                            req.update(new_data)
                            req["id"] = rid

                            # Метаданные правки
                            if editor:
                                req["last_editor"] = editor
                            req["last_edit_ts"] = time.strftime("%Y-%m-%d %H:%M:%S")

                            saved = save_request_to_db(req)
                            # 1) Явный ACK инициатору
                            await websocket.send(json.dumps({
                                "action": "edit_request",
                                "status": "success",
                                "id": rid,
                                "message": "Заявка успешно отредактирована"
                            }))

                            # 2) Шлём свежую версию
                            updated = get_request_from_db(rid) or saved or req
                            if editor:
                                updated["last_editor"] = editor
                            await broadcast({"action": "request_updated", "data": updated})
                            # >>> STATUSES: из заявки, с привязкой даты к каждому водителю
                            try:
                                reconcile_statuses_from_request(updated)
                                rows = list_vehicle_statuses()
                                await broadcast({"action": "statuses_sync", "data": rows})
                                logging.info(f"[statuses] reconcile_from_request id={updated.get('id')}")
                            except Exception:
                                logging.exception("[statuses] reconcile after edit_request failed")


                            logging.info("Broadcasted request_updated for id=%s", rid)

                        except Exception as e:
                            logging.error(f"Ошибка редактирования заявки: {e}")
                            await websocket.send(json.dumps({
                                "action": "edit_request",
                                "status": "error",
                                "message": "Ошибка редактирования заявки"
                            }))

                elif action == "delete_request":
                    task_id = data.get("id")
                    if task_id:
                        try:
                            deleteTask(task_id)
                            await broadcast({"action": "trigger_sync"}, exclude_ws=websocket)
                            await websocket.send(json.dumps({
                                "action": "response",
                                "status": "success",
                                "message": "Заявка удалена"
                            }))
                        except Exception as e:
                            logging.error(f"Ошибка удаления заявки: {e}")
                            await websocket.send(json.dumps({"error": "Ошибка удаления заявки"}))

                # --- Регистрация пользователя ---
                elif action == "register":
                    username = data.get("username")
                    password = data.get("password")
                    role = data.get("role", "user")

                    if not username or not password:
                        await websocket.send(json.dumps({
                            "action": "register",
                            "status": "fail",
                            "message": "❌ Необходимо указать логин и пароль"
                        }))
                        return

                    success = add_user(username, password, role)
                    if success:
                        await websocket.send(json.dumps({
                            "action": "register",
                            "status": "success",
                            "message": "✅ რეგისტრაცია წარმატებით შესრულდა"
                        }))
                    else:
                        await websocket.send(json.dumps({
                            "action": "register",
                            "status": "fail",
                            "message": "❌ Этот пользователь уже существует или данные некорректны"
                        }))


                # --- Авторизация пользователя ---
                elif action == "auth":
                    username = data.get("username")
                    password = data.get("password")
                    user = get_user(username)
                    print(f"USER FROM DB: {user}")
                    if user and check_password(password, user["password"]):
                        import uuid
                        session_token = str(uuid.uuid4())
                        await websocket.send(json.dumps({
                            "action": "auth",
                            "status": "success",
                            "role": user.get("role", "user"),
                            "username": user["username"],
                            "session_token": session_token
                        }))
                    else:
                        await websocket.send(json.dumps({
                            "action": "auth",
                            "status": "fail",
                            "message": "❌ მომხმარებელი არ მოიძებნა ან პაროლი არასწორია"
                        }))

                elif action == "resume_session":
                    token = data.get("token")
                    # Здесь должна быть ваша логика проверки токена, если вы её делаете
                    # Для MVP достаточно просто принять любой токен как валидный:
                    await websocket.send(json.dumps({
                        "action": "resume_session",
                        "status": "success"
                    }))

                # --- Остальной код (attach, comment, update_request, sync_all) — без изменений ---

                elif action == "file":
                    task_id = str(data.get("task_id"))      # ВСЕГДА str!
                    filename = data.get("filename")
                    filedata = data.get("filedata")
                    if not all([task_id, filename, filedata]):
                        print("UPLOAD ERROR: missing params")
                        return

                    # Декодируем и сохраняем файл
                    os.makedirs(f"attachments/task_{task_id}", exist_ok=True)
                    file_path = f"attachments/task_{task_id}/{filename}"
                    with open(file_path, "wb") as f:
                        f.write(base64.b64decode(filedata))
                    print(f"[SERVER] Файл сохранён: {file_path}")

                    # Обновляем заявку в БД
                    req = get_request_from_db(task_id)
                    if req is not None:
                        if "attachments" not in req or not isinstance(req["attachments"], list):
                            req["attachments"] = []
                        if filename not in req["attachments"]:
                            req["attachments"].append(filename)
                        saved = save_request_to_db(req)
                        rid = (saved or req).get("id")
                        updated = get_request_from_db(rid) or saved or req
                        await broadcast({"action": "request_updated", "data": updated})

                
                elif action == "upload_file":
                    try:
                        request_id = str(data.get("request_id"))
                        filename = data.get("filename")
                        content_base64 = data.get("content_base64")
                        file_type = data.get("file_type", "driver_file")  # не используется, но может пригодиться

                        if not all([request_id, filename, content_base64]):
                            await websocket.send(json.dumps({
                                "action": "upload_file",
                                "status": "error",
                                "error": "Некорректные параметры для загрузки файла"
                            }))
                            return

                        # Декодируем файл
                        file_bytes = base64.b64decode(content_base64)
                        save_dir = f"attachments/request_{request_id}"
                        os.makedirs(save_dir, exist_ok=True)
                        safe_name = filename.replace("/", "_").replace("\\", "_")
                        file_path = os.path.join(save_dir, safe_name)
                        with open(file_path, "wb") as f:
                            f.write(file_bytes)

                        # Формируем url (пусть отдаётся как /files/request_id/filename через nginx/flask)
                        url = f"/files/request_{request_id}/{safe_name}"

                        await websocket.send(json.dumps({
                            "action": "upload_file",
                            "status": "ok",
                            "file": {
                                "name": filename,
                                "url": url
                            }
                        }))
                    except Exception as e:
                        await websocket.send(json.dumps({
                            "action": "upload_file",
                            "status": "error",
                            "error": str(e)
                        }))

                elif action == "download_file":
                    try:
                        task_id = str(data.get("task_id"))
                        filename = data.get("filename")
                        paths = [
                            f"attachments/task_{task_id}/{filename}",
                            f"attachments/request_{task_id}/{filename}"
                        ]
                        found = False
                        for file_path in paths:
                            if os.path.exists(file_path):
                                with open(file_path, "rb") as f:
                                    filedata = base64.b64encode(f.read()).decode("utf-8")
                                await websocket.send(json.dumps({
                                    "action": "download_file",
                                    "filename": filename,
                                    "filedata": filedata
                                }))
                                found = True
                                break
                        if not found:
                            await websocket.send(json.dumps({
                                "action": "download_file",
                                "filename": filename,
                                "filedata": None,
                                "error": "File not found"
                            }))
                    except Exception as e:
                        await websocket.send(json.dumps({
                            "action": "download_file",
                            "filename": filename,
                            "filedata": None,
                            "error": f"Server error: {e}"
                        }))

                elif action == "add_comment":
                    task_id = data.get("task_id")
                    comment = data.get("comment")
                    if not (task_id and comment):
                        await websocket.send(json.dumps({"error": "Нет данных для комментария"}))
                        return
                    all_requests = load_all_requests()
                    for req in all_requests:
                        if str(req.get("id")) == str(task_id):
                            comments = req.get("comments", [])
                            comments.append(comment)
                            req["comments"] = comments
                            save_request_to_db(req)
                            break
                    await websocket.send(json.dumps({"action": "add_comment", "status": "success"}))
                    # req — это заявка с обновлённым комментарием
                    await broadcast({
                        "action": "add_comment",
                        "task_id": task_id,
                        "comment": comment
                    })
                    print("[SERVER] ⏱ ОТПРАВЛЕНО КЛИЕНТУ:",
                          time.time(), action)

                elif action == "update_request":
                    request_data = data.get("data")
                    if not request_data or not request_data.get("id"):
                        await websocket.send(json.dumps({"action": "update_request", "status": "error", "message": "Нет данных для обновления"}))
                        return
                    try:
                        print(
                            f"[DEBUG] server.py update_request: id={request_data.get('id')}, drivers={request_data.get('drivers')}")
                        saved = save_request_to_db(request_data)
                        await websocket.send(json.dumps({"action": "update_request", "status": "success"}))
                        # берём «свежую» версию из БД на всякий случай
                        rid = (saved or request_data).get("id")
                        updated = get_request_from_db(rid) or saved or request_data
                        await broadcast({"action": "request_updated", "data": updated})

                        # >>> STATUSES: reconcile and broadcast (после обычного сохранения)
                        try:
                            reconcile_statuses_from_request(updated)
                            rows = list_vehicle_statuses()
                            await broadcast({"action": "statuses_sync", "data": rows})
                            logging.info(f"[statuses] reconcile_from_request id={updated.get('id')}")
                        except Exception:
                            logging.exception("[statuses] reconcile after update_request failed")
                                                                        
                    except Exception as e:
                        import traceback
                        traceback.print_exc()
                        await websocket.send(json.dumps({"action": "update_request", "status": "error", "message": f"Ошибка при сохранении: {e}"}))

                elif action == "unknown":
                    await websocket.send(json.dumps({
                        "action": "error",
                        "message": "Неизвестная команда"
                    }))
                    
                elif action == "sync_all":
                    all_data = load_all_requests()
                    await websocket.send(_json_dumps_safe({"action": "sync_all", "data": all_data}))

                elif action == "statuses_sync":
                    try:
                        rows = list_vehicle_statuses()
                        await websocket.send(_json_dumps_safe({"action": "statuses_sync", "data": rows}))
                    except Exception as e:
                        await websocket.send(_json_dumps_safe({"action": "statuses_sync", "status": "error", "message": str(e)}))

                elif action == "statuses_set_text":
                    rid = int(data.get("request_id") or 0)
                    vehicle = (data.get("vehicle_number") or "").strip()
                    text = data.get("text") or ""
                    if not (rid and vehicle):
                        await websocket.send(json.dumps({"action": "statuses_set_text", "status": "error", "message": "bad params"}))
                    else:
                        set_vehicle_status_text(rid, vehicle, text)
                        rows = list_vehicle_statuses()
                        await broadcast({"action": "statuses_sync", "data": rows})
                elif action == "set_request_status":
                    rid = int(data.get("id") or 0)
                    status = data.get("status") or (data.get("data") or {}).get("status")
                    # Если все машины по заявке выгружены, принудительно считаем статус "closed"
                    try:
                        if str(status).lower().strip() != 'closed' and all_unloaded_for_request(rid):
                            status = 'closed'
                    except Exception as _e:
                        logging.error(f"[statuses] enforce closed on set_request_status failed: {_e}")
                    if not rid or not status:
                        await websocket.send(json.dumps({
                            "action": "request_updated",
                            "status": "error",
                            "message": "bad params"
                        }))
                    else:
                        try:
                            req = get_request_from_db(rid) or {"id": rid}
                            # Пишем статус в JSON заявки (нормализация — в save_request_to_db)
                            d = dict(req)
                            d['status'] = status
                            save_request_to_db(d)
                            updated = get_request_from_db(rid)
                            if updated:
                                await broadcast({"action": "request_updated", "data": updated})
                        except Exception as e:
                            await websocket.send(json.dumps({"action": "request_updated", "status": "error", "message": str(e)}))

                elif action == "statuses_toggle_unloaded":
                    rid = int(data.get("request_id") or 0)
                    vehicle = (data.get("vehicle_number") or "").strip()
                    unloaded = data.get("unloaded", None)  # может быть True/False/None
                    unload_date = data.get("unload_date") or None
                    if isinstance(unload_date, str) and len(unload_date) >= 10:
                        unload_date = unload_date[:10]
                    toggle_vehicle_unloaded(rid, vehicle, unloaded, unload_date)

                    # если поставили галочку — проверяем, не закрылась ли заявка целиком
                    try:
                        if unloaded is True and all_unloaded_for_request(rid):
                            set_request_status_closed(rid)
                            updated = get_request_from_db(rid)
                            if updated:
                                await broadcast({"action": "request_updated", "data": updated})
                    except Exception as e:
                        logging.error(f"[statuses] auto-close failed: {e}")

                    rows = list_vehicle_statuses()
                    await broadcast({"action": "statuses_sync", "data": rows})

                elif action == "logout":
                    await websocket.close(code=1000, reason="Logout")
                    continue

            except Exception as e:
                logging.error("📛 შეცდომა შეტყობინების დამუშავებისას: %s", e)
                await websocket.send(json.dumps({"error": "💥 სერვერის შიდა შეცდომა"}))
    except websockets.exceptions.ConnectionClosed:
        logging.info("🔌 კლიენტი გათიშულია — IP: %s, Port: %s", ip, port)
    finally:
        connected_clients.discard(websocket)

def _extract_vehicles_and_load_date(req: dict):
    """Возвращает (список номеров ТС, дата_загрузки_DD-MM-YYYY|None) из заявки."""
    vehicles = []
    for d in (req.get('drivers') or []):
        for key in ('stateNumber', 'vehicleNumber', 'plate', 'carNumber', 'number', 'tsNumber'):
            v = d.get(key)
            if v:
                vehicles.append(str(v).strip())
                break
    # Уникальные и непустые
    vehicles = sorted({v for v in vehicles if v})

    # Дата загрузки: берём первую из loading_dates (или None)
    load_date = None
    for ld in (req.get('loading_dates') or []):
        date = (ld.get('date') or ld.get('loading_date') or ld.get('day') or '').strip()
        if date:
            load_date = date[:10]  # DD-MM-YYYY
            break
    return vehicles, load_date

async def _run_midnight_clear_and_broadcast():
    """Ждём до ближайшей полуночи, чистим статус дня и рассылаем обновление."""
    while True:
        now = dt.datetime.now()
        tomorrow = now + dt.timedelta(days=1)
        midnight = dt.datetime.combine(tomorrow.date(), dt.time(0, 0, 0))
        await asyncio.sleep((midnight - now).total_seconds())
        try:
            clear_daily_status_texts()
            rows = list_vehicle_statuses()
            await broadcast({"action": "statuses_sync", "data": rows})
        except Exception as e:
            logging.error(f"[statuses] midnight clear failed: {e}")


async def _run_periodic_cleanup_48h():
    """Раз в 30 минут удаляем строки, где выгрузка старше 48ч."""
    while True:
        try:
            cleanup_unloaded_rows_older_than_48h()
        except Exception as e:
            logging.error(f"[statuses] 48h cleanup failed: {e}")
        await asyncio.sleep(1800)  # 30 минут


async def main():
    logging.info("სერვერის გაშვება...")
    async with websockets.serve(handle_client, "0.0.0.0", 8766):
        # фоновые задачи для статусов
        asyncio.create_task(_run_midnight_clear_and_broadcast())
        asyncio.create_task(_run_periodic_cleanup_48h())
        # initial daily clear and statuses snapshot
        try:
            clear_daily_status_texts()
            rows = list_vehicle_statuses()
            await broadcast({"action": "statuses_sync", "data": rows})
        except Exception as e:
            logging.error(f"[statuses] initial clear/sync failed: {e}")
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
