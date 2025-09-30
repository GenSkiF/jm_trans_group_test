// frontend/js/app.js
import { AuthService } from './auth.js';
import { showSection, setCurrentSection } from './core/router.js';

(async () => {
  try {
    const ok = await AuthService.init();
    const mainSection = document.getElementById('main-section');
    const authBlock   = document.getElementById('auth-block');

    if (ok) {
      if (authBlock) authBlock.style.display = 'none';
      if (mainSection) mainSection.style.display = '';
      setCurrentSection('announcements');
      showSection('announcements');
    } else {
      if (mainSection) mainSection.style.display = 'none';
      if (authBlock) authBlock.style.display   = '';
    }
  } catch {
    const mainSection = document.getElementById('main-section');
    const authBlock   = document.getElementById('auth-block');
    if (mainSection) mainSection.style.display = 'none';
    if (authBlock) authBlock.style.display   = '';
  }
})();
