# Activos de marca

## Original preservado

- Archivo: `sena-logo-original.png`.
- Origen: PNG suministrado por el autor del proyecto; copia conservada en `sena-logo-original.png`.
- SHA-256: `d5c537cae2b1a2e0943874c97bddcd72e2b04c7b8cde1fcdc7a080dcfcc9c6c9`.
- Formato medido: PNG indexado sRGB de 185 × 185 px, 8 bits, con canal alfa.
- Bbox alfa ≥ 50%: `171x166+7+9`.
- Color opaco dominante medido: `#1A8545` (`oklch(54.37% 0.1349 151.45)`).

El original se conserva sin modificación. No se descargó ni redibujó otro símbolo. El uso en SenaLSC identifica el contexto de un **Proyecto académico SENA** y no afirma que sea una aplicación oficial. No se acredita autorización de marca; su publicación y redistribución están sujetas a la autorización correspondiente.

## Derivados

`npm run brand:prepare` ejecuta `scripts/prepare-brand-assets.mjs` con ImageMagick y genera:

- `sena-logo-ui.png` y `favicon.png` para el renderer.
- PNG transparentes de 16, 24, 32, 48, 64, 128, 256 y 512 px.
- `icon.ico` con frames de 16 a 256 px para Windows.
- `tray-on-light.png` y `tray-on-dark.png` de 20 px.

Los iconos de bandeja son recortes transparentes del bbox medido y usan la silueta alfa del logo original. La variante para tema claro usa verde oscuro; la variante para tema oscuro usa blanco cálido. Son ajustes de contraste y escala, no un símbolo nuevo.
