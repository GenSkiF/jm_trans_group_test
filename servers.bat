@echo off
chcp 65001 >nul
setlocal

:: === НАСТРОЙКИ ПОРТОВ/ХОСТОВ ===
set "HTTP_PORT=9101"
set "WS_HOST=0.0.0.0"
set "WS_PORT=8766"

:: === ГДЕ ПРОЕКТ ===
set "PROJECT_ROOT=C:\Users\ASUS1\OneDrive\Apps\jm_trans_group_test\"
if exist "%PROJECT_ROOT%backend" if exist "%PROJECT_ROOT%frontend" goto have_root
echo [ERROR] Не вижу backend/frontend по пути PROJECT_ROOT=%PROJECT_ROOT%
pause & exit /b 1
:have_root

:: === PYTHON ===
set "PY=py -3"
%PY% -V >nul 2>&1 || set "PY=python"
set "PYTHONUTF8=1"

:: === ТОЧКА ВХОДА БЭКЕНДА (ищем по приоритету) ===
set "BACKEND=%PROJECT_ROOT%backend\services\websocket_server.py"
if not exist "%BACKEND%" set "BACKEND=%PROJECT_ROOT%backend\websocket_server.py"
if not exist "%BACKEND%" set "BACKEND=%PROJECT_ROOT%backend\main.py"
if not exist "%BACKEND%" (
  echo [ERROR] Не найден websocket_server.py или main.py в backend
  pause & exit /b 1
)

:: === ОТКРЫТЬ ПОРТЫ В WINDOWS FIREWALL (один раз можно выполнить и закомментировать) ===
:: netsh advfirewall firewall add rule name="JMTG_HTTP_%HTTP_PORT%" dir=in action=allow protocol=TCP localport=%HTTP_PORT%
:: netsh advfirewall firewall add rule name="JMTG_WS_%WS_PORT%"    dir=in action=allow protocol=TCP localport=%WS_PORT%

:: === ЗАПУСК ФРОНТЕНДА (локальная раздача UI) ===
start "FRONTEND :%HTTP_PORT%" cmd /k ^
  pushd "%PROJECT_ROOT%frontend" ^& ^
  %PY% -u -m http.server %HTTP_PORT% --bind 0.0.0.0

:: === ЗАПУСК БЭКЕНДА (WebSocket) ===
:: ВАРИАНТ А: если твой сервер УМЕЕТ --host/--port
:: start "BACKEND  :WS" cmd /k ^
::   pushd "%PROJECT_ROOT%backend" ^& ^
::   set PYTHONPATH=%PROJECT_ROOT% ^& ^
::   %PY% -u "%BACKEND%" --host %WS_HOST% --port %WS_PORT%

:: ВАРИАНТ Б: если не умеет ключи — просто запускаем (важно: внутри он должен слушать 0.0.0.0:%WS_PORT%)
start "BACKEND  :WS" cmd /k ^
  pushd "%PROJECT_ROOT%backend" ^& ^
  set PYTHONPATH=%PROJECT_ROOT% ^& ^
  %PY% -u "%BACKEND%"

:: === (ОПЦИОНАЛЬНО) ЗАПУСК ТУННЕЛЯ ИЗ ЭТОГО ЖЕ BAT ===
:: --- Cloudflare Tunnel (если установлен cloudflared) ---
:: start "RTR cloudflared" cmd /k ^
::   cloudflared tunnel --no-autoupdate --protocol http2 run ^
::   --url http://127.0.0.1:%HTTP_PORT% ^
::   --http-host-header 127.0.0.1
::
:: Для WebSocket через тот же домен HTTPS (wss) cloudflared сам пробрасывает на локальный 8766,
:: если фронтенд стучится на wss://<твой_домен>:443 -> ws://127.0.0.1:%WS_PORT% (настраивается в дашборде).

:: --- frp (если используешь frpc) ---
:: start "RTR frpc" cmd /k ^
::   frpc.exe -c "%PROJECT_ROOT%ops\frpc.ini"

endlocal
