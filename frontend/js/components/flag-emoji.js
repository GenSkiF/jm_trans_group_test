// frontend/js/components/flag-emoji.js
// ISO Alpha-2 (GE, AM, RU, …) → emoji-флаг (🇬🇪, 🇦🇲, …)

export function countryCodeToEmoji(code) {
  const cc = (code || "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return "";
  const OFFSET = 127397;
  return String.fromCodePoint(cc.codePointAt(0)+OFFSET, cc.codePointAt(1)+OFFSET);
}
