(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.JMTGPins = factory();
  }
}(this, function () {
  'use strict';

  const palette = {
    green:  '#27ae60',
    blue:   '#2b7cff',
    red:    '#e74c3c',
    orange: '#f39c12',
    purple: '#8e44ad',
    cyan:   '#00bcd4',
    yellow: '#f1c40f',
    gray:   '#95a5a6',
    black:  '#2d3436',
    teal:   '#1abc9c',
  };

  function esc(s){
    return String(s||'').replace(/[&<>"']/g, ch => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[ch]));
  }

  function dropSVG(opts){
    const o = Object.assign({ color: palette.blue, size: 46, dot: false, label: null, stroke: '#17324a' }, opts||{});
    const w = Math.round(o.size * (30/46));
    const h = Math.round(o.size);
    const inner = o.dot ? '<circle cx="15" cy="18" r="5" fill="white" />'
               : (o.label ? `<text x="15" y="21" font-family="system-ui, -apple-system, Segoe UI, Roboto, Arial" font-weight="700" font-size="12" fill="#fff" text-anchor="middle">${esc(o.label)}</text>`
                          : '');
    const svg = `
<svg width="${w}" height="${h}" viewBox="0 0 30 46" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="shadow" x="-50%" y="-50%" width="200%" height="200%">
      <feDropShadow dx="0" dy="2" stdDeviation="2" flood-opacity=".25"/>
    </filter>
    <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${o.color}"/>
      <stop offset="100%" stop-color="${o.color}"/>
    </linearGradient>
  </defs>
  <path filter="url(#shadow)" d="M15 45c6.8-10.1 13-17.5 13-26C28 8.2 22.3 2 15 2S2 8.2 2 19c0 8.5 6.2 15.9 13 26z"
        fill="url(#grad)" stroke="${o.stroke}" stroke-width="1"/>
  ${inner}
</svg>`.trim();
    return svg;
  }

  function badgeSVG(opts){
    const o = Object.assign({ text: '1', color: palette.red }, opts||{});
    const svg = `
<svg width="32" height="20" viewBox="0 0 32 20" xmlns="http://www.w3.org/2000/svg">
  <defs><filter id="shadow" x="-50%" y="-50%" width="200%" height="200%">
    <feDropShadow dx="0" dy="2" stdDeviation="2" flood-opacity=".25"/>
  </filter></defs>
  <rect x="1" y="1" rx="10" ry="10" width="30" height="18" fill="${o.color}" stroke="#17324a" stroke-width="1" filter="url(#shadow)"/>
  <text x="16" y="14" font-family="system-ui, -apple-system, Segoe UI, Roboto, Arial" font-weight="700" font-size="12" fill="#fff" text-anchor="middle">${esc(o.text)}</text>
</svg>`.trim();
    return svg;
  }

  // Leaflet helpers (if L available)
  function leafletDrop(opts){
    const html = dropSVG(opts);
    const size = opts && opts.size ? opts.size : 46;
    const w = Math.round(size * (30/46));
    const h = Math.round(size);
    if (typeof L !== 'undefined' && L && L.divIcon) {
      return L.divIcon({ className: 'svg-pin', html, iconSize: [w, h], iconAnchor: [w/2, h], popupAnchor: [0, -Math.round(h*0.85)] });
    }
    return { html, size: [w,h] };
  }

  function leafletBadge(opts){
    const html = badgeSVG(opts);
    if (typeof L !== 'undefined' && L && L.divIcon) {
      return L.divIcon({ className: 'jmtg-badge', html, iconSize: [32,20], iconAnchor: [16,10] });
    }
    return { html, size: [32,20] };
  }

  function from(){ return leafletDrop({ color: palette.green, size: 46, dot: true }); }
  function to(){   return leafletDrop({ color: palette.blue,  size: 46, dot: true }); }

  const api = {
    palette,
    svg: { drop: dropSVG, badge: badgeSVG },
    leaflet: { drop: leafletDrop, badge: leafletBadge, from, to },
  };

  return api;
}));