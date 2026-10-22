# Privacidad y ética

## Declaración visible

> Subtítulos automáticos en español con apoyo visual preparado para incorporar vocabulario LSC validado. Puede contener errores y no reemplaza a un intérprete.

## Tratamiento local

- El audio se captura solo durante escucha real, se transforma en PCM en memoria y se entrega al sidecar local.
- No se escriben archivos de audio, no hay telemetría ni servicio remoto de transcripción.
- La transcripción permanece en memoria. Solo se escribe TXT o JSON después de una acción explícita y un diálogo nativo. TXT incluye `[DEMOSTRACIÓN]` o `[RECONOCIMIENTO LOCAL]`; JSON conserva `source: "demo"` o `source: "asr"`.
- Los ajustes visuales se guardan localmente, pero no contienen voz, texto de clase ni datos personales.
- Los medios importados se copian a la carpeta `media` bajo los datos de usuario. Sus metadatos se guardan atómicamente en JSON. La ruta original, el audio y las transcripciones no se conservan.

Quien exporta una transcripción asume la responsabilidad de almacenarla y compartirla según políticas institucionales y autorización de participantes. Deben evitarse datos personales o sensibles innecesarios.

## Alcance lingüístico

LSC es una lengua con gramática, contexto y variación propios. Vincular palabras españolas con clips aislados es apoyo de vocabulario, no traducción completa. Un avatar, glosario o sistema automático no sustituye la competencia lingüística y cultural de un intérprete humano.

La Biblioteca LSC incorpora 52 videos académicos canónicos y 129 originales comunitarios EXPRESA, sin conceptos físicos repetidos. La biblioteca principal requiere opt-in y resultado final; el contenido comunitario es una subopción legal separada que exige fuente incorporada, licencia y referencia completas. EXPRESA se usa solo con fines académicos/no comerciales y sin derivados. `pending` nunca se activa y la importación local no puede autodeclararse `academic` ni `community`.

El deletreo técnico no representa una seña léxica ni una traducción. Reproduce letras originales de EXPRESA una por una, sin generar un archivo combinado, y mantiene visible el término completo asociado.

El producto debe mantener visibles sus límites, especialmente en evaluaciones, trámites, salud, seguridad o situaciones disciplinarias donde un error puede causar daño. En esos contextos se requiere apoyo humano calificado.

## Clips y comunidad

No se deben extraer ni empaquetar videos de INSOR, FENASCOL o cualquier tercero sin autorización escrita. Acceso público no significa licencia de redistribución.

Un clip futuro debe:

1. Mostrar a una persona que aceptó grabación, edición y distribución.
2. Documentar concepto, frase fuente, contexto, variante o región y límites de uso.
3. Ser revisado por personas sordas usuarias de LSC, con participación remunerada cuando corresponda.
4. Registrar autorización y validación sin publicar datos personales innecesarios.
5. Permanecer `pending` hasta completar el proceso. Solo `validated` habilita coincidencia automática normal; `academic` y `community` quedan reservados a fuentes incorporadas y atribuidas.

## Riesgos y mitigaciones

- **Error de transcripción:** mostrar parciales distintos de finales y aviso permanente.
- **Falsa equivalencia lingüística:** llamar a la función apoyo visual de vocabulario, no traductor LSC.
- **Uso de frases preparadas como evidencia ASR:** rótulo persistente de demostración, sesiones cancelables y origen explícito en TXT/JSON.
- **Saturación de audio:** FIFO observable de hasta 10 segundos, sin descarte silencioso. Si se supera, el sistema muestra `El equipo no procesa el audio en tiempo real`, termina ASR y detiene la captura.
- **Pérdida de privacidad:** no guardar audio, no telemetría y exportación explícita.
- **Apropiación de material:** no incluir medios de terceros y exigir autorización.
- **Exposición de archivos locales:** el renderer recibe una URL `senalsc-media://` por ID; nunca recibe la ruta original o una ruta absoluta.
