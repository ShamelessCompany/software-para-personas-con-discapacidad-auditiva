# Arquitectura

## Visión general

SenaLSC separa responsabilidades para que el renderer no tenga acceso a Node.js ni pueda iniciar procesos arbitrarios.

```text
Micrófono
  -> renderer React (getUserMedia, PCM mono 16 kHz)
  -> preload contextBridge (API mínima)
  -> main Electron (validación IPC, límite y backpressure)
  -> sidecar Python/Vosk (stdin/stdout JSON local)
  -> resultados parciales/finales
  -> matcher conservador de biblioteca visual
  -> barra de subtítulos configurable y medio activo arriba a la derecha
```

## Capas

- `src/renderer`: interfaz, captura, estado y visualización. Los ajustes se guardan en `localStorage`; audio e historial no.
- `src/preload`: expone `window.senaLsc` con métodos concretos. Nunca expone `ipcRenderer` ni eventos Electron.
- `src/main`: crea ventanas aisladas, valida origen y payload, controla permisos, exporta mediante diálogo nativo, administra el sidecar y mantiene la biblioteca visual local.
- `src/shared`: contratos, canales, normalización, reducer, matcher y validadores puros.
- `sidecar`: carga Vosk y el modelo. Recibe PCM codificado en base64 por líneas JSON y devuelve parciales o finales.
- `assets/lsc`: 181 MP4/181 conceptos en un catálogo unificado: LSC50 50, UniValle 2 y EXPRESA 129. Los manifiestos conservan licencia/procedencia y el reporte canónico comprueba duplicados, faltantes y huérfanos.

## Seguridad Electron

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` en ambas ventanas.
- CSP en el documento del renderer.
- Navegación y nuevas ventanas bloqueadas.
- Los handlers comprueban emisor `file://` o Vite local de desarrollo.
- Los permisos se deniegan salvo audio solicitado por el origen local; video no se permite.
- Frecuencia, chunks, exportación y estado completo de las superficies residentes se validan antes de usarse.
- El renderer solo exporta mediante diálogo nativo; no elige rutas arbitrarias.
- El protocolo `senalsc-media://media/<id>` se registra antes de `ready`. Resuelve solo IDs permitidos hacia recursos bundled o archivos administrados, comprueba `realpath`, bloquea traversal y symlinks, aplica MIME y `nosniff`, y soporta `Range` para video.
- CSP permite `senalsc-media:` solo en `img-src` y `media-src`. Navegación externa continúa bloqueada.

## Biblioteca visual

El modelo `VisualLibraryEntry` conserva ID, etiqueta, frases, palabras clave, contexto, región, estado, validación, autorización, descriptor de medio, habilitado y fechas. Main copia importaciones válidas a `app.getPath("userData")/media` con nombres UUID. El JSON `media-library.json` se escribe primero a un archivo temporal con permisos restringidos y se reemplaza mediante `rename`; un borrado mueve el medio a tombstone, persiste metadatos y solo entonces lo elimina.

La inicialización se comparte entre llamadas concurrentes. Las importaciones, ediciones y eliminaciones se ejecutan como transacciones serializadas por instancia: preparación del estado, persistencia atómica y actualización en memoria. Una operación rechazada no bloquea las siguientes. Esto no proporciona coordinación entre instancias o procesos independientes.

La importación admite PNG, JPEG, WebP y GIF hasta 15 MB, y MP4 o WebM hasta 100 MB. Verifica archivo regular, extensión, firma mágica, tamaño y la copia final. SVG solo se admite para los recursos propios bundled.

## Reconocimiento

`getUserMedia` produce una pista. Un `AudioWorklet` local entrega ventanas de 20 ms; un remuestreador stateful genera PCM16 mono a 16 kHz y un agregador envía bloques binarios de 640 muestras/40 ms por IPC. Main limita cada bloque a 256 KiB y solo allí codifica Base64/JSON para stdin del sidecar. WO Mic desactiva cancelación de eco, supresión de ruido y ganancia automática para evitar doble procesamiento; otros micrófonos conservan esas ayudas.

Ambos perfiles crean `KaldiRecognizer(model, sample_rate)` en modo abierto y habilitan tres alternativas, words y partial words. Una lista técnica solo desempata una alternativa situada como máximo 0,015 por debajo de la de mayor confianza; nunca reescribe texto. Parciales idénticos se eliminan en el sidecar y nuevamente en el renderer, sin temporizador ni demora para texto nuevo.

El sidecar detecta `SetEndpointerMode` y `SetEndpointerDelays`: si existen, configura final objetivo a 0,8 s de silencio; Vosk 0.3.45 instalado no los expone y reporta explícitamente fallback a `model.conf`, cuyas reglas usan 0,5/1,0/2,0 s. Cada resultado informa proceso→resultado, último word→final cuando Vosk entrega tiempos, duración de segmento, confianza y CPU acumulada. Main agrega primer parcial, último final, endpoint→final, cola máxima y desbordamientos.

El lifecycle explícito es `stopped -> starting -> running -> stopping -> stopped`. Main serializa start/stop y asigna un `sessionId` positivo. Durante `STOPPING` conserva esa sesión, vacía la FIFO, envía `stop` y acepta únicamente su `final` con causa `stop-flush`; después invalida la sesión. `start()` solo concluye al recibir `ready`; `stop()` espera `exit`, aplica timeout y luego cierre forzado seguro. Una salida inesperada invalida la operación, detiene la captura y notifica a la UI. Resultados de procesos cerrados o reemplazados se ignoran.

La escritura respeta el retorno de `stdin.write()`. Una FIFO conserva orden y duración mientras espera `drain`, y publica audio enviado, pendiente, bloques, máximo de cola y desbordamientos. El límite es 10 segundos: no descarta silenciosamente; al superarlo emite error visible, termina el proceso y el renderer detiene el AudioWorklet/micrófono.

Los inicios repetidos con la misma configuración son idempotentes. Un inicio incompatible mientras se reconoce audio se rechaza sin cambiar el perfil, la frecuencia ni la sesión reales; para reconfigurar se debe detener primero. La inspección tampoco sustituye los metadatos del motor activo. Los errores de `stdin` invalidan la sesión mediante el flujo de fallo y limpieza; los errores tardíos de un proceso anterior no afectan a su reemplazo.

La captura usa un `AudioWorklet` local incluido en el paquete y permitido por la CSP; no carga scripts remotos.

## Modelo y distribución

En desarrollo están disponibles `vosk-model-small-es-0.42` (Rápido) y `vosk-model-es-0.42` (Preciso). El portable Windows autónomo incorpora Rápido; Preciso permanece externo por su tamaño. El AppImage no incorpora modelos Vosk ni un runtime ASR funcional: la escucha real no está disponible en Linux empaquetado. El desarrollo local en Linux sí permite ASR con Python/Vosk y los modelos preparados según el README.

El portable recomendado usa `electron-builder.complete.yml`: incluye Python 3.12.10 embebible x64, Vosk 0.3.45, dependencias, sidecar y modelo Rápido. `npm run package:win:complete` fija versiones/tamaños/SHA-256, valida PE32+ AMD64, hashes de árbol, modelo, medios y app.asar, y extrae el EXE final para inspección. Es autónomo para Rápido; Preciso requiere el modelo grande externo. La construcción e inspección se realizan desde Linux y no sustituyen una prueba física nativa en Windows x64.

`npm run package:win:demo` usa otra identidad/configuración, excluye el ejecutable sidecar, el modelo y cualquier runtime Python como recursos, muestra un rótulo permanente y deshabilita escucha real. El ASAR puede conservar código main compartido, pero el marcador demo bloquea esa ruta y la UI no la ofrece. No se presenta como prueba de ASR.

## Matcher visual

El matcher normaliza mayúsculas, tildes y puntuación y exige límites de palabra. `pending` nunca activa; `validated` exige autorización y dos validadores; `academic` y `community` exigen opt-in separado y resultado final. `community` solo acepta EXPRESA incorporado con licencia y referencia completas. Un controlador técnico reconoce una lista explícita de términos, valida todas sus letras, aplica cooldown y crea una playlist cancelable de URLs opacas.

Cada sesión visual usa una clave derivada de `sessionId` o de la generación demo. Una respuesta tardía se descarta si cambió la generación. El snapshot incluye URL opaca, razón, texto asociado, playlist, índice y `playbackKey`. El subtítulo usa el texto asociado mientras exista medio, aunque lleguen parciales. El renderer superior avanza al evento `ended`; los renderers ocultos pausan su video, por lo que nunca se reproducen dos letras simultáneamente.

## Sesiones y superficies residentes

Cada inicio de demo invalida la generación anterior y registra todos sus intervalos/timeouts. Pausar o detener cancela pendientes, por lo que una frase tardía no entra al historial. Un controlador único serializa demo, micrófono y ASR: cambiar a ASR cancela demo; cambiar a demo invalida cualquier inicio real pendiente, limpia sus recursos y espera el cierre confirmado de ASR. La procedencia actual permanece visible mientras se muestra ese contenido y TXT/JSON conservan el origen.

Main mantiene la última instantánea como fuente de verdad, incluido el medio y `playbackKey`. Crea dos BrowserWindow sin marco, transparentes, sin sombra, pasivas, no enfocables y fuera de la barra de tareas. La barra usa ancho 560–1.200 px, alto 104–180 px y posición superior, inferior o flotante; la app principal controla la altura flotante entre 15% y 85% sin retirar click-through. El medio conserva relación 4:3, 280 × 210 px base y clamp 240–360 px, con margen de 20–28 px desde la esquina superior derecha. Si la barra está arriba, el medio baja 12 px después de ella. Ambos siguen el display más cercano al cursor y se recalculan en cambios de display, `workArea` o DPI; las coordenadas siempre permanecen dentro del área útil. La superficie de video se oculta sin medio activo. Al montar, cada renderer registra primero `overlay:state` y luego invoca `overlay:get-state`; así recibe un estado existente sin perder una actualización concurrente. Si un medio falla, el subtítulo permanece visible.

## Límites técnicos

- Vosk reconoce español; no traduce lingüísticamente a LSC.
- La calidad depende de micrófono, ruido, dicción, vocabulario y modelo.
- No hay diarización ni identificación de hablantes.
- Las superficies residentes comparten estado con la interfaz principal; main controla su posición y visibilidad.
- El MVP no incluye actualización automática ni firma de código. El portable Windows completo incorpora el modelo Rápido; el AppImage y la edición Demo no incorporan modelos. La validación física en Windows con micrófono y voz sigue pendiente.
