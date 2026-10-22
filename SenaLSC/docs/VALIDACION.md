# Validación de entrega

Fecha: 7 de septiembre de 2026.

## Rediseño e identidad

- El PNG suministrado se preservó sin modificación en `assets/brand/sena-logo-original.png`; SHA-256 `d5c537cae2b1a2e0943874c97bddcd72e2b04c7b8cde1fcdc7a080dcfcc9c6c9`.
- Medición técnica: 185 × 185 px, PNG indexado sRGB de 8 bits, alpha real, bbox alfa `171x166+7+9`, esquinas transparentes y color opaco dominante `#1A8545` (`oklch(54.37% 0.1349 151.45)`).
- `scripts/prepare-brand-assets.mjs` genera logo UI, favicon, PNG de 16/24/32/48/64/128/256/512, ICO multi-size y bandeja de alto contraste para temas claro/oscuro. Todos conservan transparencia; no hay fondo blanco accidental ni SVG de marca.
- La consola de activación mantiene CTA y selector visibles en 1280 × 720 y 1366 × 768. Expone micrófono, prueba, motor offline, una sola Biblioteca LSC y las subopciones legales de contenido comunitario/deletreo.
- Los estados Listo, Solicitando permiso, Sin micrófono, Audio detectado, Motor cargando, Escuchando, Pausado y Requiere atención tienen icono, etiqueta y explicación; no dependen solo del color.
- El copy identifica el producto como `Proyecto académico SENA` y no afirma aval institucional ni traducción completa a LSC.

## Resultado funcional

- Se corrigió la simultaneidad: mientras existe `activeMedia`, el overlay inferior conserva `presentationText`, aunque llegue un parcial nuevo. Al expirar el medio vuelve a parciales/finales normales.
- El deletreo conserva abajo el término completo y reproduce arriba una sola letra original por vez. Una coincidencia nueva cancela la playlist anterior.
- Los BrowserWindow de subtítulos y apoyo visual mantienen bounds separados, transparencia, `alwaysOnTop`, ausencia de foco y click-through.
- La barra admite `Arriba`, `Abajo` y `Flotante`, dos líneas y geometría persistente. La altura flotante se mueve desde la app principal sin desactivar click-through. El video usa 280 × 210 px base arriba a la derecha y baja si la barra está arriba.
- El matcher exige final y límites de palabra. `community` requiere fuente EXPRESA incorporada, licencia/referencia completas y opt-in separado. La importación segura no puede crear entradas `academic` ni `community`.

## EXPRESA

- Descargados y verificados **129 MP4 originales**, **249.196.042 bytes**, **129 conceptos** y **0 omitidos**.
- Categorías: alfabeto 27 archivos/55.717.509 bytes; tecnología 29/57.512.697; colegio 29/54.458.156; hogar 20/37.302.752; comida-bebida 11/20.631.751; cuerpo-acciones 13/23.573.177.
- Selección total: **181 videos/181 conceptos**: 50 LSC50, 2 UniValle sin equivalente de mayor prioridad y 129 EXPRESA. El reporte `assets/lsc/unified-lsc-catalog.json` confirma 0 claves canónicas duplicadas, 0 assets huérfanos y 0 faltantes; conserva las nueve variantes UniValle omitidas y diferencia correctamente `N` de `Ñ`.
- Cada registro conserva `source: original`, nombre, tamaño, MD5 y SHA-1 oficiales, SHA-256 calculado, URLs, glosa, categoría, licencia, atribución y `transformation: "none"`.
- SHA-256 del manifiesto EXPRESA: `2d5dd87c6f85f87c944c25fa96720c6fe939665376f1f303bcc5676daa64f754`.
- Licencia visible: CC BY-NC-ND 3.0 Unported. Uso académico/no comercial; archivos y velocidad originales, sin derivados. Una colección de signos aislados no equivale a traducción gramatical completa.

## Deletreo técnico

- Dos opt-in independientes: EXPRESA comunitario y deletreo técnico.
- Términos: Python, JavaScript, TypeScript, Java, HTML, CSS, SQL, Git, GitHub, API, JSON, React, Angular, Node, Docker, Linux, Windows, variable, función, clase, objeto, arreglo, compilador, servidor, base de datos, error, prueba, código, programa y algoritmo.
- Normalizaciones explícitas incluyen `java script`, `type script`, `git hub`, `node js`, `c sharp` y `c plus plus`.
- Badge: `DELETREO LSC · TÉRMINO TÉCNICO`; nunca afirma una seña léxica.
- Si falta una letra, Ñ o número, la secuencia no se activa y deja diagnóstico. Hay cooldown por término y cancelación por término/sesión nueva.

## Validaciones ejecutadas

| Comprobación | Resultado |
| --- | --- |
| `npm run lint` | Correcto. |
| `npm run typecheck` | Correcto. |
| `npm test` | 139 pruebas aprobadas en 18 archivos. Incluyen geometría 1280/1366/1920, DPI/monitor desplazado, movimiento flotante desde la app principal, AudioWorklet/resampling/agregación 40 ms, 10 minutos FIFO, desborde visible, `stop-flush`, expiración, catálogo, permisos, seguridad y paquetes. |
| `./.venv/bin/python -m unittest sidecar/test_asr.py` | 9 pruebas aprobadas: selección estrecha de alternativas, confianza, deduplicación de parciales, endpointing API/fallback y telemetría. |
| `.venv/bin/python sidecar/asr.py --self-test` | Correcto: Vosk, protocolo 1. |
| `npm run benchmark:asr` | Cinco arranques sin voz: Rápido proceso→`ready` p50/p95 389,542/392,047 ms; Preciso 5.259,369/5.339,249 ms, outlier 9.091,181 ms. Ambos `open-alternatives`; endpointing por `model.conf` porque Vosk 0.3.45 no expone setters. |
| `npm run benchmark:audio` | Diez minutos sintéticos: 60 ms p50/p95 0,972/5,941 µs, CPU 109,443 ms, espera máxima 40 ms; 40 ms 0,861/5,891 µs, CPU 96,718 ms, espera máxima 20 ms. Seleccionado 40 ms. |
| `npm run smoke:gui` | Correcto con `DISPLAY=:0`, `WAYLAND_DISPLAY=wayland-1`: logo, CTA y selector visibles a 1280 × 720, 1366 × 768 y 1920 × 1080; barra compacta con metadatos, video discreto, targets simultáneos y click-through. |
| `npm run package:linux` | Correcto. |
| `npm run package:win:demo` | Correcto; sigue siendo únicamente Demo ASR. |
| `npm run package:win:candidate` | Correcto desde Linux como empaquetado candidato no-demo; no equivale a ejecución Windows. |
| `npm run package:win:complete` | Correcto desde Linux: runtime oficial preparado, preflight, build portable e inspección por extracción. |
| Runtime Windows embebido | Python 3.12.10 `pythonw.exe` PE32+ AMD64; Vosk 0.3.45, `_cffi_backend`, `libvosk.dll` y DLLs transitivas presentes; 328 archivos y 80.200.450 bytes antes del modelo. Se retiraron la utilidad de autocompletado de shell de `tqdm` y el fallback de ruta Linux de Vosk, innecesarios en Windows. |
| Modelo ligero incorporado | 14 archivos, 60.286.598 bytes; estructura y hash de árbol contrastados con `embedded-asr.manifest.json`. |
| Inspección del portable completo | Lanzador PE válido y aplicación interna PE32+ AMD64; 619 archivos extraídos y 548 en `resources`, logo/iconos PNG, 181 MP4, tres manifiestos, catálogo unificado, 0 duplicados/huérfanos y 0 SVG; 14 archivos de modelo, `asr.py`, runtime y atribución presentes; sin PowerShell, scripts de preparación, `.venv`, logs, secretos, rutas Linux, `python.exe` ni modelo grande. Distribución `complete-windows`; `package.json` interno sin scripts, dependencias de desarrollo ni configuración de empaquetado. |
| Integridad ZIP y `SHA256SUMS.txt` | Correcto para los 22 componentes enumerados. |
| WO Mic Linux | Supervisor reemplazado por PID `447447` en modo `usb`; configuración estricta USB/RNDIS, sin descubrimiento ni fallback Wi-Fi. Sin teléfono conectado: 0 endpoint y 0 `micclient`, con diagnóstico físico en `~/.local/state/wo-mic/supervisor.log`. |
| Modelo ligero externo | Correcto: estructura Vosk esperada, 14 archivos, 60.286.598 bytes y SHA-256 de árbol verificado. |
| PowerShell | `pwsh` no estaba disponible; revisión estática únicamente. No se afirma validación sintáctica nativa. |

Electron 44 sobre Wayland no expone `Browser.getWindowForTarget` y las páginas reportan coordenadas de contenido en vez de bounds nativos. Por eso el smoke prueba simultaneidad real en dos targets independientes y la suite unitaria comprueba que `calculateOverlayBounds` produce rectángulos separados dentro del área de trabajo.

## Inspección interna

- AppImage: 283 archivos extraídos; logo/favicon e iconos derivados, 181 MP4, tres manifiestos, catálogo unificado, 0 SVG y ningún modelo Vosk.
- AppImage y Windows completo conservan `assets/lsc/expresa/manifest.json`, LSC50, UniValle, `unified-lsc-catalog.json` y `THIRD_PARTY_NOTICES.md`.
- Windows completo: distribución `complete-windows` no-demo dentro de `app.asar`; `package.json` interno saneado; aplicación y runtime PE32+ AMD64; `resources/embedded-asr/pythonw.exe`, Vosk/DLLs; modelo ligero; `sidecar/asr.py`; 181 MP4 y atribuciones fuera de ASAR. La extracción confirmó permiso exclusivo de audio/origen interno, selector, prueba de micrófono y los contadores 181/181.

## Artefactos

- `release/SenaLSC-0.1.0-x86_64.AppImage`: **346.140.223 bytes**; SHA-256 `69567b02c2e756e94f3e5f17ccb1e084c37d7962b3cdc5348c822fae2e26d839`.
- `release/SenaLSC-Demo-Portable-0.1.0-x64.exe`: **319.253.705 bytes**; SHA-256 `9ca82e26d8d6f940aa0526083b1f468bcaada86f25d9164e100b02f9a73dfd15`.
- `release/candidate-build/SenaLSC-Windows-Candidato-NoValidado-0.1.0-x64.exe`: **319.271.664 bytes**; SHA-256 `31e12d2aff2d103d593f5c619f19530e1d5e2931f3890e5fbc05933013418009`.
- `release/SenaLSC-Windows-USB-Candidato-0.1.0.zip`: **358.774.006 bytes**; SHA-256 `c49c0793c431bb466bfe8c19321b66be6453d7278439d44d5d9ccb1dd1c79ae6`.
- Modelo ligero incorporado: **60.286.598 bytes** en 14 archivos; SHA-256 de árbol `71fe21723a9f847e1fb52b48470f1a0fc4f8a72d1246683780425be32bd9ede2`; ZIP oficial `09b239888f633ef2f0b4e09736e3d9936acfd810bc65d53fad45261762c6511f`.
- `release/SenaLSC-Portable-Completo-0.1.0-x64.exe`: **365.974.958 bytes**; SHA-256 `527fb0d64cb1a93c8f2f25b861dba6f341583aed102578beb327b093f1d8c0b9`. Es la entrega Windows recomendada y autónoma con Rápido.
- `assets/lsc/unified-lsc-catalog.json`: SHA-256 `b8c6cda031e0420ff8d84e6e5df44b3d250acfa1470ec35dbeb0c8140a1008fd`.
- `release/LEEME-SENALSC-WINDOWS.txt`: instrucciones exclusivamente gráficas para copiar, abrir, permitir, elegir, probar e iniciar.

## Limitaciones

- El Windows Demo no es funcional para ASR y ya no es el recomendado.
- El portable completo es autónomo y fue verificado estáticamente desde Linux, pero no se ejecutó nativamente en Windows. La única validación pendiente es la prueba física Windows x64 con un micrófono real y voz, incluido WO-Mic cuando esté disponible.
- No existe fixture local de voz etiquetado ni TTS disponible. Por eso no se reportan WER ni p50/p95 de primer parcial/final; los valores 389,542/392,047 ms y 5.259,369/5.339,249 ms corresponden solo a proceso→`ready` sin voz.
- El portable incluye Rápido, no Preciso. Solicitar Preciso sin el modelo grande produce fallback visible; cargar Preciso puede tomar varios segundos incluso cuando está disponible.
- WO Mic requiere conectar el teléfono por USB, activar Anclaje USB y pulsar Start. Hasta entonces el supervisor permanece en espera estricta sin fallback Wi-Fi.
- Los signos aislados, incluido el deletreo, no sustituyen interpretación humana ni traducción gramatical LSC.
- EXPRESA no puede usarse comercialmente ni modificarse. Si un original deja de ser reproducible en Electron, debe omitirse, nunca convertirse.
