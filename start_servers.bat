@echo off
chcp 65001 >nul
setlocal

:: === ГДЕ ПРОЕКТ ===
:: BAT лежит не в корне — укажем путь явно:
set "PROJECT_ROOT=C:\Users\ASUS1\OneDrive\Apps\jm_trans_group_test\"
if exist "%PROJECT_ROOT%backend" if exist "%PROJECT_ROOT%frontend" goto have_root
echo [ERROR] Не вижу backend/frontend по пути PROJECT_ROOT=%PROJECT_ROOT%
pause & exit /b 1
:have_root

:: === PYTHON ===
set "PY=py -3"
%PY% -V >nul 2>&1 || set "PY=python"

:: === ТОЧКА ВХОДА БЭКЕНДА ===
set "BACKEND=%PROJECT_ROOT%backend\services\websocket_server.py"
if not exist "%BACKEND%" set "BACKEND=%PROJECT_ROOT%backend\websocket_server.py"
if not exist "%BACKEND%" set "BACKEND=%PROJECT_ROOT%backend\main.py"
if not exist "%BACKEND%" (
  echo [ERROR] Не найден websocket_server.py или main.py в backend
  pause & exit /b 1
)

:: === ЗАПУСК СЕРВЕРОВ В ОТДЕЛЬНЫХ ОКНАХ ===
:: (фикс кавычек: используем pushd и ^&)
start "FRONTEND :9101" cmd /k pushd "%PROJECT_ROOT%" ^& %PY% -u -m http.server 9101 --bind 0.0.0.0
start "BACKEND  :WS"   cmd /k pushd "%PROJECT_ROOT%" ^& set PYTHONPATH=%PROJECT_ROOT% ^& %PY% -u "%BACKEND%"

