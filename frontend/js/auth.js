// frontend/js/auth.js
import { WebSocketService } from './services/api.js';

export class AuthService {
    static generatedCode = null;
    static currentUser = null;

    static async init() {
        // Проверяем существующую сессию
        const token = localStorage.getItem("jm_session_token");
        if (token) {
            // Пытаемся подтвердить сессию по WS
            const resumed = await this.resumeSession(token);
            if (resumed) return resumed;

            // Мягкий режим: НЕ выходим из аккаунта из-за кратких сетевых сбоев.
            // Оставляем пользователя «внутри» и ждём автоворкфлоу реконнекта.
            const username = localStorage.getItem("jm_session_username") || "";
            const role = localStorage.getItem("jm_session_role") || "user";
            this.currentUser = { username, role, token };
            return this.currentUser;
        }
        return false;
    }

    static async login(username, password) {
        try {
            const response = await WebSocketService.sendAndWait({
                action: "auth",
                username,
                password
            });

            if (response.status === "success") {
                const role = response.role || "user";
                this.currentUser = { username, role, token: response.session_token };

                localStorage.setItem("jm_session_token", response.session_token);
                localStorage.setItem("jm_session_username", username);
                localStorage.setItem("jm_session_role", role); // 👈 сохраняем роль для последующих resume
                return this.currentUser;
            } else {
                throw new Error(response.message || "Ошибка авторизации");
            }
        } catch (error) {
            console.error("Auth error:", error);
            throw error;
        }
    }

    static async register(userData) {
        // Валидация на клиенте
        if (userData.password !== userData.password2) {
            throw new Error("Пароли не совпадают");
        }

        try {
            const response = await WebSocketService.sendAndWait({
                action: "register",
                ...userData,
                role: "user"
            });

            if (response.status === "success") {
                return response;
            } else {
                throw new Error(response.message || "Ошибка регистрации");
            }
        } catch (error) {
            console.error("Registration error:", error);
            throw error;
        }
    }

    static async sendConfirmationCode(phone) {
        this.generatedCode = Math.floor(1000 + Math.random() * 9000);
        // В реальном приложении здесь будет отправка SMS
        return this.generatedCode;
    }

    static async resumeSession(token) {
        try {
            const response = await WebSocketService.sendAndWait({ action: "resume_session", token });

            if (response?.status === "success") {
                const username = localStorage.getItem("jm_session_username") || this.currentUser?.username || "";
                const role = response.role || localStorage.getItem("jm_session_role") || "user";

                this.currentUser = { username, role, token };
                return this.currentUser;
            } else {
                // Не выходим из аккаунта из-за сетевого сбоя/медленного ответа.
                // Просто сообщаем вызывающему коду, что пока не подтвердили.
                return false;
            }
        } catch (error) {
            // В случае таймаута/обрыва — НЕ делаем logout. Дадим WS переподключиться и повторить resume на onopen.
            return false;
        }
    }



    static logout() {
        this.currentUser = null;
        localStorage.removeItem("jm_session_token");
        localStorage.removeItem("jm_session_username");
        WebSocketService.send({ action: "logout" });
    }

    static logout() {
        // 1. Сброс авторизованного пользователя
        AuthService.currentUser = null;

        // 2. Удалить токены и имя пользователя из localStorage
        localStorage.removeItem("jm_session_token");
        localStorage.removeItem("jm_session_username");

        // 3. Если есть открытый WebSocket — закрыть его
        if (window.ws && typeof window.ws.close === 'function') {
            window.ws.close();
            window.ws = null;
        }

        // 4. Вернуть на экран авторизации, скрыть main-section
        const mainSection = document.getElementById('main-section');
        const authBlock = document.getElementById('auth-block');
        if (mainSection) mainSection.style.display = 'none';
        if (authBlock) authBlock.style.display = '';
    }
}

