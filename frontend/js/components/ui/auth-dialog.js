// frontend/js/components/ui/auth-dialog.js
import { AuthService } from '../../auth.js';

export class AuthDialog {
    constructor() {
        this.dialog = document.createElement('div');
        this.dialog.className = 'auth-dialog';
        this.render();
        document.body.appendChild(this.dialog);
        this.initEvents();
    }

    render() {
        this.dialog.innerHTML = `
            <div class="auth-dialog-content">
                <h3 id="auth-title">Вход в систему</h3>
                <form id="auth-form">
                    <div class="form-group">
                        <input type="text" id="auth-username" placeholder="Логин" required>
                    </div>
                    <div class="form-group">
                        <input type="password" id="auth-password" placeholder="Пароль" required>
                    </div>
                    <div id="register-fields" style="display:none">
                        <div class="form-group">
                            <input type="password" id="auth-password2" placeholder="Повторите пароль">
                        </div>
                        <div class="form-group">
                            <input type="text" id="auth-name" placeholder="Имя">
                        </div>
                        <div class="form-group">
                            <input type="text" id="auth-surname" placeholder="Фамилия">
                        </div>
                        <div class="form-group">
                            <input type="tel" id="auth-phone" placeholder="Телефон">
                        </div>
                        <div class="form-group">
                            <input type="email" id="auth-email" placeholder="Email">
                        </div>
                        <div class="form-group code-group">
                            <input type="text" id="auth-code" placeholder="Код подтверждения">
                            <button type="button" id="send-code-btn">Отправить код</button>
                        </div>
                    </div>
                    <button type="submit" id="auth-submit">Войти</button>
                    <button type="button" id="auth-toggle-mode">Регистрация</button>
                    <div id="auth-error" class="error-message"></div>
                </form>
            </div>
        `;
    }

    initEvents() {
        document.getElementById('auth-toggle-mode').addEventListener('click', () => this.toggleMode());
        document.getElementById('auth-form').addEventListener('submit', (e) => this.handleSubmit(e));
        document.getElementById('send-code-btn')?.addEventListener('click', () => this.sendCode());
    }

    toggleMode() {
        const isRegister = document.getElementById('register-fields').style.display === 'block';
        document.getElementById('register-fields').style.display = isRegister ? 'none' : 'block';
        document.getElementById('auth-title').textContent = isRegister ? 'Вход в систему' : 'Регистрация';
        document.getElementById('auth-submit').textContent = isRegister ? 'Войти' : 'Зарегистрироваться';
        document.getElementById('auth-toggle-mode').textContent = isRegister ? 'Регистрация' : 'Уже есть аккаунт?';
        this.clearError();
    }

    async sendCode() {
        const phone = document.getElementById('auth-phone').value;
        if (!phone) {
            this.showError('Введите номер телефона');
            return;
        }
        
        try {
            const code = await AuthService.sendConfirmationCode(phone);
            this.showError(`Код подтверждения: ${code}`, false);
        } catch (error) {
            this.showError(error.message);
        }
    }

    async handleSubmit(e) {
        e.preventDefault();
        this.clearError();

        const isRegister = document.getElementById('register-fields').style.display === 'block';
        const username = document.getElementById('auth-username').value;
        const password = document.getElementById('auth-password').value;

        if (!username || !password) {
            this.showError('Заполните все обязательные поля');
            return;
        }

        try {
            if (isRegister) {
                const userData = {
                    username,
                    password,
                    password2: document.getElementById('auth-password2').value,
                    name: document.getElementById('auth-name').value,
                    surname: document.getElementById('auth-surname').value,
                    phone: document.getElementById('auth-phone').value,
                    email: document.getElementById('auth-email').value,
                    code: document.getElementById('auth-code').value
                };
                
                await AuthService.register(userData);
                this.toggleMode();
                this.showError('Регистрация успешна! Теперь вы можете войти.', false);
            } else {
                await AuthService.login(username, password);
                this.close();
                window.location.reload();
            }
        } catch (error) {
            this.showError(error.message);
        }
    }

    showError(message, isError = true) {
        const errorEl = document.getElementById('auth-error');
        errorEl.textContent = message;
        errorEl.style.color = isError ? 'red' : 'green';
        errorEl.style.display = 'block';
    }

    clearError() {
        document.getElementById('auth-error').style.display = 'none';
    }

    show() {
        this.dialog.style.display = 'flex';
    }

    close() {
        this.dialog.style.display = 'none';
    }
}