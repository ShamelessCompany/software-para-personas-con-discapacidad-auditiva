# SenaLSC

Proyecto académico SENA de escritorio para Windows, orientado a aprendices sordos. Genera subtítulos automáticos en español de forma local y ofrece apoyo visual preparado para incorporar vocabulario LSC validado. No se presenta como aplicación oficial del SENA.

> Subtítulos automáticos en español con apoyo visual preparado para incorporar vocabulario LSC validado. Puede contener errores y no reemplaza a un intérprete.

SenaLSC no afirma traducir automáticamente una conversación completa a LSC. Incluye una Biblioteca LSC opcional de 181 videos/181 conceptos: 52 académicos canónicos y 129 originales comunitarios EXPRESA. EXPRESA es una subopción separada de uso académico/no comercial y conserva los videos sin modificaciones.

## Funciones del MVP

- Captura del micrófono seleccionado, medidor de nivel e inicio, pausa, reanudación y parada.
- Consola de activación accesible con CTA, selector y prueba de micrófono visibles sin navegar; probada a 1280 × 720 y 1366 × 768.
- Selector real de entradas de audio, incluido `default`, `communications`, WO-Mic y dispositivos físicos; etiquetas reveladas tras permiso, actualización por `devicechange`, persistencia segura y fallback único al predeterminado.
- Prueba de micrófono de cuatro segundos con medidor y diagnóstico, sin guardar audio ni iniciar Vosk.
- AudioWorklet local de 20 ms, remuestreo stateful a PCM16 mono 16 kHz y bloques IPC binarios de 40 ms.
- Perfiles `Rápido` (`vosk-model-small-es-0.42`, incluido y recomendado) y `Preciso` (`vosk-model-es-0.42`, grande y opcional), con fallback visible a Rápido.
- Reconocimiento abierto offline mediante Vosk en un sidecar separado. Ningún perfil fuerza la conversación a una gramática cerrada; el vocabulario técnico solo desempata alternativas de confianza casi equivalente.
- FIFO observable de 10 segundos, deduplicación de parciales idénticos, words/partial words, confianza, telemetría de primer parcial, endpoint a final, cola, desbordamientos y CPU, más cierre confirmado con `stop-flush`.
- Subtítulos parciales y finales, historial con hora y exportación explícita a TXT o JSON.
- Utilidad residente de bandeja con cierre a segundo plano, inicio y detención explícitos y reapertura de configuración.
- Identidad derivada del PNG suministrado: logo del renderer, favicon, ejecutable, taskbar e iconos de bandeja para temas claro y oscuro. El original se conserva con hash en `assets/brand/`.
- Barra compacta de subtítulos con posiciones `Arriba`, `Abajo` y `Flotante`, dos líneas, ancho/alto/tipografía persistentes, estado discreto, procesamiento local y micrófono seleccionado. La altura flotante se mueve desde la app principal y el overlay permanece click-through durante el uso normal.
- Apoyo visual de 280 × 210 px base, fijado arriba a la derecha del monitor activo con margen de 20 a 28 px; baja automáticamente si la barra ocupa la parte superior.
- Ajustes locales de tipografía, contraste, geometría de la barra, apoyo visual, duración de 8 a 12 segundos y velocidad de clip.
- Deletreo técnico opt-in para 30 términos: reproduce secuencialmente un original EXPRESA por letra a velocidad 1× y lo rotula como deletreo, no como seña léxica.
- Biblioteca visual con búsqueda, habilitado, previsualización, importación y borrado seguro de medios importados.
- Matcher conservador que prioriza frases exactas y largas; LSC50 solo coincide con una glosa final completa, no con palabras dentro de frases.
- Modo demostración claramente rotulado, sin usar el micrófono y con callbacks cancelados al detener o cambiar de fuente.
- IPC permitido por lista cerrada, renderer aislado y permisos denegados salvo audio local.
- Sin telemetría, almacenamiento de audio o exportación automática.

## Requisitos de desarrollo

- Node.js 22 o superior y npm 10 o superior.
- Python 3.10 a 3.12 para desarrollo local en Linux. El portable Windows completo incluye su propio Python y no usa una instalación del sistema.
- `unzip` para verificar y extraer el modelo con el script de descarga en cualquier plataforma.
- Micrófono y permiso de audio del sistema operativo para escucha real.

## Instalación

```bash
npm ci
npm run sidecar:setup
npm run model:download
# Opcional: modelo grande para el perfil Preciso
npm run model:download:large
```

El modelo pequeño se instala en `models/vosk-model-small-es-0.42`. El perfil preciso instala el modelo oficial grande de 1.484.681.703 bytes en `models/vosk-model-es-0.42`; su ZIP verificado en esta entrega tiene SHA-256 `bbbfaf9239bed5dcb0d140886b5834fcc13c13c7fb2f2799ae790f03ff20bfce`. Vosk no publica checksum en la ficha, por lo que el script fija este hash observado además del nombre, tamaño, HTTPS, dominio y estructura segura. El modelo grande no entra en AppImage ni portable.

Si Vosk no instala con el Python predeterminado, use Python 3.12:

```bash
python3.12 -m venv .venv
.venv/bin/python -m pip install -r sidecar/requirements.txt
SENA_LSC_PYTHON="$PWD/.venv/bin/python" npm run dev
```

## Desarrollo

```bash
npm run dev
```

Si faltan Python, Vosk o el modelo, la escucha real queda deshabilitada y la aplicación informa el componente faltante. `Probar demostración` sigue disponible, siempre con el rótulo `MODO DEMOSTRACIÓN`.

## Verificación

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run smoke
npm run benchmark:audio
npm run benchmark:asr
# Lint, typecheck, tests, build y smoke (sin benchmarks):
npm run verify
```

`npm run smoke:gui` comprueba en el mismo instante ambos BrowserWindow, la barra compacta, el final asociado fijado mientras llega un parcial nuevo, el video superior derecho, bounds separados y superficies transparentes/click-through sin activar micrófono. La UI principal se valida a 1280 × 720, 1366 × 768 y 1920 × 1080.

## Biblioteca visual e importación

Abra `Biblioteca visual`, complete el formulario inline y elija un archivo mediante el diálogo nativo. Se admiten PNG, JPG/JPEG, WebP y GIF hasta 15 MB, y MP4 o WebM hasta 100 MB. El archivo se copia a `app.getPath("userData")/media`; la ruta original nunca llega al renderer. Los metadatos se guardan atómicamente en `media-library.json`.

El estado inicial recomendado es `Pendiente`. Para `LSC validado` debe registrar autorización o licencia, referencia y al menos dos validadores. La aplicación comprueba que existan esos campos, pero la validación lingüística sigue siendo responsabilidad de la comunidad sorda participante.

`Biblioteca LSC` es una sola preferencia. `Contenido comunitario no comercial` y `Deletreo técnico` son subopciones; al apagar la biblioteca también se apagan ambas. Las fuentes académicas y comunitarias exigen resultado final; `community` exige además fuente incorporada, licencia y manifiesto completos.

Para grabar un clip propio: obtenga permiso escrito de la persona, acuerde contexto, región, distribución y retiro, grabe un plano claro sin reutilizar material de terceros, importe el archivo como `pending` y solicite revisión de al menos dos personas sordas usuarias de LSC antes de cambiar el estado.

## Empaquetado

### Linux

```bash
npm run package:linux
```

Produce un AppImage en `release/`. El ASR no está disponible en el Linux empaquetado: no incluye runtime ni modelo y actualmente no hay una ruta de escucha real para ese paquete. El desarrollo local en Linux sí admite ASR con Python, Vosk y modelo preparados como se indica arriba; no debe confundirse con soporte ASR del AppImage.

Los tamaños y hashes siguientes documentan artefactos históricos inspeccionados en el proyecto original; este repositorio importa código y medios, no esos binarios ni una nueva certificación de funcionamiento.

- `release/SenaLSC-0.1.0-x86_64.AppImage`
- Tamaño: **346.140.223 bytes**.
- SHA-256: `69567b02c2e756e94f3e5f17ccb1e084c37d7962b3cdc5348c822fae2e26d839`.

La extracción final confirmó 283 archivos, logo/favicon e iconos derivados, 181 MP4/181 conceptos, tres manifiestos, catálogo unificado, 0 claves duplicadas, 0 assets huérfanos y 0 SVG visuales fabricados.

### Windows

El artefacto recomendado es:

- `release/SenaLSC-Portable-Completo-0.1.0-x64.exe`
- Tamaño: **365.974.958 bytes**.
- SHA-256: `527fb0d64cb1a93c8f2f25b861dba6f341583aed102578beb327b093f1d8c0b9`.

Es un único EXE portable x64 autónomo: contiene la aplicación Electron no-demo, la identidad PNG derivada, Python 3.12.10 embebible x64 oficial, `pythonw.exe`, Vosk 0.3.45 y sus dependencias, `sidecar/asr.py`, `vosk-model-small-es-0.42` completo, 181 MP4/181 conceptos, tres manifiestos, catálogo unificado y avisos de terceros. No requiere PowerShell, CMD, terminal, Python, winget, modelo externo ni instalación.

El primer inicio abre la consola de activación. La persona permite el micrófono desde la UI, elige el dispositivo, pulsa `Probar micrófono` y luego `Iniciar subtítulos`. El motor ejecuta un self-check real con timeout antes de abrir la captura de audio. Si falla, el error aparece dentro de la aplicación y no se abre una terminal.

Para reproducir el artefacto desde el código fuente:

```bash
npm run package:win:complete
```

Ese comando descarga únicamente artefactos oficiales fijados por versión, tamaño y SHA-256; prepara el runtime privado sin utilidades de terminal, valida `pythonw.exe` y DLLs como PE32+ AMD64, verifica hashes de árbol, modelo, medios y configuración, construye un solo objetivo portable y extrae el EXE resultante para inspeccionarlo. La receta queda registrada en `embedded-asr/embedded-asr.manifest.json` dentro del portable. El `package.json` interno no conserva scripts, dependencias de desarrollo ni configuración de empaquetado.

La validación disponible se realizó estáticamente desde Linux y no se presenta como ejecución nativa Windows. Queda pendiente una prueba física en Windows x64 con micrófono real.

En cinco arranques sin micrófono ni voz, proceso→`ready` midió p50/p95 **389,542/392,047 ms** para Rápido y **5.259,369/5.339,249 ms** para Preciso; Preciso tuvo un outlier de 9.091,181 ms. No son latencias de transcripción. Ambos perfiles emitieron `open-alternatives`; Rápido es el recomendado por disponibilidad y tiempo de carga, mientras Preciso solo conviene cuando el modelo grande está realmente instalado y el equipo tolera la espera.

El benchmark sintético de diez minutos de PCM comparó batch IPC de 60 frente a 40 ms. En la corrida final, 60 ms obtuvo p50/p95 **0,972/5,941 µs**, CPU **109,443 ms** y 40 ms de espera máxima de ensamblado; 40 ms obtuvo **0,861/5,891 µs**, CPU **96,718 ms** y 20 ms de espera. Se eligió 40 ms. No existe fixture local de voz etiquetado ni TTS disponible, por lo que no se reportan WER ni p50/p95 de primer parcial/final; la aplicación los mide durante una sesión real sin inventar resultados.

### Empaquetados anteriores

`npm run package:win` conserva el flujo histórico con sidecar PyInstaller. `npm run package:win:demo` y el candidato USB también se conservan para trazabilidad, pero el Demo ya no es la entrega recomendada porque no incluye ASR real. No se requieren para usar el portable completo.

La edición Demo crea `SenaLSC-Demo-Portable-...exe`, muestra `EDICIÓN DEMOSTRATIVA`, oculta la escucha real y sirve únicamente para presentar UI y frases preparadas.

### Candidato Windows para memoria USB

`release/SenaLSC-Windows-USB-Candidato-0.1.0.zip` se conserva como artefacto histórico. Fue construido e inspeccionado en Linux, pero no ejecutado en Windows; ha sido reemplazado como recomendación por el portable completo autónomo.

- ZIP: **358.774.006 bytes**; SHA-256 `c49c0793c431bb466bfe8c19321b66be6453d7278439d44d5d9ccb1dd1c79ae6`.
- Portable: **319.271.664 bytes**; SHA-256 `31e12d2aff2d103d593f5c619f19530e1d5e2931f3890e5fbc05933013418009`.
- Modelo externo: 14 archivos, **60.286.598 bytes**; SHA-256 de árbol `f65ec2b1fc992f4c699193a45ff406bfbeccdf0853841b34312130467c10691c`.

No use ese ZIP para una instalación nueva. La validación final pendiente para el portable completo es nativa: iniciar el EXE en Windows x64, permitir micrófono, seleccionar el dispositivo, probar audio, hablar y confirmar subtítulos reales. SmartScreen puede advertir porque el ejecutable no tiene firma de editor.

## Solución de problemas

- **Motor o modelo ausente en el portable completo:** el EXE está incompleto o fue alterado; vuelva a copiar el archivo cuyo SHA-256 coincide con esta documentación.
- **Permiso denegado:** habilite el micrófono para SenaLSC en Privacidad y seguridad de Windows y reinicie la escucha.
- **Micrófono desconectado:** conecte el dispositivo, pulse actualizar y selecciónelo de nuevo.
- **Sidecar cerrado:** la aplicación detiene la escucha, informa el fallo y nunca cambia silenciosamente a demostración. Revise modelo/sidecar y vuelva a iniciar.
- **Cambio de perfil durante la escucha:** detenga el reconocimiento antes de cambiar el perfil o la frecuencia. Una solicitud incompatible se rechaza con `Detén el reconocimiento antes de cambiar el perfil o la frecuencia de muestreo.` sin alterar la sesión activa.
- **Fallo al enviar audio:** `Falló el envío de audio al reconocedor: …` indica un error del canal de audio del proceso. Se invalida la sesión y se detiene el motor; revise el diagnóstico y vuelva a iniciar.
- **Audio saturado:** la UI muestra cola y latencias. Se conservan hasta 10 segundos en FIFO; al superar el límite se muestra `El equipo no procesa el audio en tiempo real` y se detiene la captura, sin descarte silencioso.
- **Sin etiquetas de micrófono:** conceda permiso de audio; Chromium revela nombres después del acceso.
- **Sin apoyo automático:** active Biblioteca LSC; incluya EXPRESA solo si acepta su restricción no comercial/sin derivados. Cada fuente mantiene su rótulo y política.
- **Video no reproduce:** pruebe MP4 H.264 o WebM compatible. El subtítulo permanece visible y la UI informa el error de códec.

## Privacidad, ética y licencias

Consulte `docs/PRIVACIDAD-Y-ETICA.md` y `docs/LICENCIAS-TERCEROS.md`. Los clips siguen `assets/lsc/README.md`. El código está bajo MIT; modelos, dependencias y clips incluidos o futuros conservan licencias o autorizaciones separadas. MIT no se aplica a los videos. EXPRESA limita la distribución a uso académico/no comercial y sin derivados. El uso académico no oficial del logo SENA no acredita autorización de marca; su publicación y redistribución están sujetas a la autorización correspondiente.

Para colaborar, consulte [CONTRIBUTING.md](../CONTRIBUTING.md). Los modelos, entornos y `resources/embedded-asr/` se obtienen mediante las recetas existentes y no se incluyen en Git.
