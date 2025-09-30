// frontend/js/components/flag-icon.js
import { countryCodeToEmoji } from './flag-emoji.js';

export function renderFlagSpan(cc) {
  const code = String(cc || "").trim();
  if (!code) return "";
  const upper = code.toUpperCase();
  const lower = code.toLowerCase();
  // Иконка видима, а в текст попадает только emoji → копируется корректно
  return `<span class="fi fi-${lower}" aria-hidden="true"></span>${countryCodeToEmoji(upper)}`;
}

export function applyFlagIcon(el, cc) {
  const code = String(cc || "").trim();
  if (!el) return;
  if (!code) {
    el.style.display = "none";
    el.className = "fi";
    el.textContent = "";
    return;
  }
  el.className = `fi fi-${code.toLowerCase()}`;
  el.removeAttribute("title");
  el.style.display = "";
  el.textContent = countryCodeToEmoji(code.toUpperCase());
}
