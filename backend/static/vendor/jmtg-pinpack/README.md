# JMTG Pin Pack (Leaflet-ready)

Готовый набор красивых пинов для карт + маленькая JS-библиотека.
Работает без сборщиков, подходит для Leaflet (через `L.divIcon`) и как чистые SVG.

## Состав
- `svg/` — статические SVG-иконки (по цветам)
- `dist/jmtg-pins.js` — UMD-библиотека с фабриками пинов (SVG + Leaflet helper)
- `css/jmtg-pins.css` — базовые стили (опционально)
- `examples/leaflet-demo.html` — демо-страница

## Быстрый старт (статические SVG)
1. Скопируй папку `jmtg-pinpack` в `backend/static/vendor/` (в итоге путь будет `backend/static/vendor/jmtg-pinpack/...`).
2. Используй в `map.html` как обычные картинки:
   ```html
   <img src="/vendor/jmtg-pinpack/svg/dropdot-green.svg" width="30" height="46"/>
   ```

## Быстрый старт (JS-библиотека)
1. Подключи JS после Leaflet:
   ```html
   <script src="/vendor/jmtg-pinpack/dist/jmtg-pins.js"></script>
   ```
2. Создавай пины на лету:
   ```js
   // divIcon (Leaflet)
   const iconFrom = JMTGPins.leaflet.drop({ color: JMTGPins.palette.green, size: 46, dot: true });
   const iconTo   = JMTGPins.leaflet.drop({ color: JMTGPins.palette.blue,  size: 46, dot: true });
   L.marker([lat, lon], { icon: iconFrom }).addTo(map);

   // или с меткой внутри
   const iconNumber = JMTGPins.leaflet.drop({ color: JMTGPins.palette.orange, label: '7' });
   ```

## Частые сценарии
- **Откуда / Куда**
  ```js
  const fromIcon = JMTGPins.leaflet.from(); // зелёный
  const toIcon   = JMTGPins.leaflet.to();   // синий
  ```

- **Кластеры / счетчики**
  ```js
  const clusterIcon = JMTGPins.leaflet.badge({ text: '12', color: JMTGPins.palette.purple });
  ```

## Параметры (drop)
```ts
type DropOptions = {
  color?: string;      // цвет пина
  size?: number;       // высота (px), пропорционально ширина
  dot?: boolean;       // белая точка внутри
  label?: string;      // текст внутри (альтернатива dot)
  stroke?: string;     // цвет обводки
};
```

## Лицензия
MIT.