# Medios visuales y clips LSC autorizados

Este directorio contiene una Biblioteca LSC única de 181 videos para 181 conceptos: 50 clips académicos LSC50, 2 clips académicos UniValle sin equivalente de mayor prioridad y 129 MP4 originales EXPRESA. Todos son signos aislados, nunca traducción gramatical ni contenido validado bajo la política local.

`unified-lsc-catalog.json` registra las 181 claves canónicas, comprueba cero duplicados y cero assets huérfanos, y conserva la trazabilidad de nueve variantes UniValle omitidas. El alias explícito `trabajo -> trabajar` no afecta a `N` y `Ñ`, que permanecen como letras distintas del alfabeto EXPRESA.

EXPRESA se distribuye bajo CC BY-NC-ND 3.0 exclusivamente para uso académico/no comercial. Conserva bytes, nombre y velocidad originales, con `transformation: "none"`: no se recorta, convierte, reencodifica, espeja, incrusta contenido, recombina ni generan miniaturas derivadas.

Antes de agregar un clip:

1. Obtener autorización explícita de la persona señante y del titular del video para grabar, editar, distribuir y empaquetar el archivo en una aplicación de escritorio.
2. Documentar propósito, contexto comunicativo, variante o región, fecha y duración de la autorización.
3. Validar el concepto con al menos dos personas sordas usuarias de LSC y registrar el alcance acordado. No publicar datos personales sin consentimiento.
4. Importar el archivo desde `Biblioteca visual`; la aplicación copia el original a su carpeta administrada y crea el registro como `pending` por defecto.
5. Mantener el registro como `pending` hasta completar autorización y validación. Para cambiarlo a `validated` se exige licencia o autorización, referencia y al menos dos validadores.
6. Preferir MP4 H.264 o WebM sin audio cuando el clip no requiera sonido. Verificar reproducción en el equipo objetivo, porque el soporte de códecs depende de Chromium.

La importación acepta PNG, JPG/JPEG, WebP y GIF hasta 15 MB, y MP4 o WebM hasta 100 MB. No acepta SVG importado, rutas externas, enlaces simbólicos ni archivos cuya firma no coincida con su extensión.

La atribución y límites de las tres fuentes se documentan en `THIRD_PARTY_NOTICES.md`; cada fuente conserva su manifiesto máquina-legible y se presenta dentro de una sola Biblioteca LSC.
