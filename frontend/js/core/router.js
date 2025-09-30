// js/core/router.js
import { showAnnouncementsSection } from "../pages/announcements/index.js";
import { plusAnnouncements } from '../plus.js';
import { showStatisticsSection } from "../pages/statistics/index.js";
import { showMapsSection } from "../pages/maps/index.js";
import { showStatusesSection } from "../pages/statuses/index.js";

let currentSection = '';

function highlightMainbar(section) {
  document.querySelectorAll('.mainbar-btn').forEach(btn => {
    btn.classList.remove('active');
    if (btn.getAttribute('onclick')?.includes(section)) btn.classList.add('active');
  });
}
window.highlightMainbar = highlightMainbar;

export function showSection(section) {
    currentSection = section;
    window.currentSection = section; // ← чтобы index.js понимал, где мы находимся

    // Скрываем все разделы
    document.getElementById('main-logo').style.display = 'none';
    document.getElementById('page-maps').style.display = 'none';
    document.getElementById('page-announcements').style.display = 'none';
    document.getElementById('page-transport').style.display = 'none';
    document.getElementById('page-logistics').style.display = 'none';
    document.getElementById('page-accounting').style.display = 'none';
    document.getElementById('page-statuses').style.display = 'none';
    document.getElementById('page-statistics').style.display = 'none';


    // Подсветка активной кнопки в app-bar
    if (window.highlightAppBar) window.highlightAppBar(section);

    switch(section) {
        case 'maps': {
            document.getElementById('page-maps').style.display = '';
            highlightMainbar('maps');
            const plusBtn = document.getElementById('plus-btn');
            if (plusBtn) plusBtn.onclick = null;
            if (typeof setCurrentSection === 'function') setCurrentSection('maps');

            // показать/обновить карту
            try { showMapsSection(); } catch (e) { console.error(e); }
            break;
        }
        case 'announcements':
            showAnnouncementsSection();
            document.getElementById('page-announcements').style.display = '';
            // +++ вот тут! +++
            document.getElementById('plus-btn').onclick = plusAnnouncements;
            break;

        case 'transport':
            document.getElementById('page-transport').innerHTML =
                '<div class="alert alert-info">Страница транспорта в разработке</div>';
            document.getElementById('page-transport').style.display = '';
            // +++ Плюс неактивен или другой обработчик +++
            document.getElementById('plus-btn').onclick = () => alert('Добавление транспорта скоро!');
            break;

        case 'logistics':
            document.getElementById('page-logistics').innerHTML =
                '<div class="alert alert-info">Страница логистики в разработке</div>';
            document.getElementById('page-logistics').style.display = '';
            document.getElementById('plus-btn').onclick = () => {};
            break;

        case 'accounting':
            document.getElementById('page-accounting').innerHTML =
                '<div class="alert alert-info">Страница бухгалтерии в разработке</div>';
            document.getElementById('page-accounting').style.display = '';
            document.getElementById('plus-btn').onclick = () => {};
            break;

        case 'statuses': {
            document.getElementById('page-statuses').style.display = '';
            highlightMainbar('statuses');
            const plusBtn = document.getElementById('plus-btn');
            if (plusBtn) plusBtn.onclick = null;
            if (typeof setCurrentSection === 'function') setCurrentSection('statuses');

            // показать/обновить карту
            try { showStatusesSection(); } catch (e) { console.error(e); }
            break;
        }

        case 'statistics':
            showStatisticsSection();                 // ← ВЫЗЫВАЕМ ОТРИСОВКУ
            document.getElementById('page-statistics').style.display = '';
            document.getElementById('plus-btn').onclick = () => {}; // плюс пока не нужен
            break;

        default:
            document.getElementById('main-logo').style.display = '';
            document.getElementById('plus-btn').onclick = null;
    }
}
window.showSection = showSection;



export function setCurrentSection(section) {
    currentSection = section;
}

export function getCurrentSection() {
    return currentSection;
}
