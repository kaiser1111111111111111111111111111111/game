# Runner Color (tipo Dino)

Un juego sencillo tipo "dinosaurio de Google", pero en color, hecho con HTML + CSS + JavaScript.

## Cómo jugar
- **Abrir**: haz doble clic en `index.html` para abrirlo en tu navegador.
- **Controles**:
  - **Saltar**: Espacio / Flecha Arriba / W
  - **Móvil**: botón "Saltar" o tocar sobre el canvas
  - **Reiniciar**: Enter o clic en el panel al terminar
- **Objetivo**: evita los obstáculos (cactus y aves) y consigue la mayor puntuación. La velocidad aumenta progresivamente.

## Archivos
- `index.html`: estructura de la página y referencias a estilos y script.
- `style.css`: estilos con un look moderno y colorido.
- `script.js`: lógica del juego (canvas, jugador, obstáculos, colisiones, puntuación, récord con `localStorage`).

## Notas
- El lienzo usa una resolución lógica de 800x300 con escalado por `devicePixelRatio` para verse nítido.
- Puedes modificar colores y parámetros (velocidad base, gravedad, etc.) en `script.js`.
- Funciona offline: basta con abrir el HTML.

¡Disfruta jugando! 🎮
