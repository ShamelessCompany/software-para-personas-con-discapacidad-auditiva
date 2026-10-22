# SenaLSC

## Registro

`product`

## Propósito

SenaLSC es una aplicación de escritorio académica para Windows que convierte voz de clase en subtítulos automáticos en español mediante reconocimiento local y ofrece apoyo visual preparado para incorporar vocabulario LSC validado. No traduce automáticamente conversaciones completas a LSC y no reemplaza a un intérprete.

La instalación incluye únicamente el catálogo académico opcional LSC50 con 50 signos aislados. En modo normal, solo una entrada `validated`, habilitada, autorizada y con al menos dos validadores puede activarse automáticamente. LSC50 requiere activación explícita, coincidencia exacta sobre texto final y mantiene el rótulo `FUENTE ACADÉMICA · LSC50`.

## Personas usuarias

- Aprendices sordos del SENA que necesitan seguir la voz del instructor mediante texto grande y estable.
- Instructores que desean comprobar el nivel de entrada y presentar conceptos visuales autorizados.
- Equipos académicos que administran y validan una biblioteca futura de clips LSC con participación de la comunidad sorda.

## Principios

1. La transcripción es la tarea principal; los controles nunca deben competir con ella.
2. La privacidad es local: el audio no se guarda, no hay telemetría y una transcripción solo se exporta por acción explícita.
3. La aplicación siempre distingue reconocimiento real, demostración preparada, fuente académica LSC50 y contenido validado.
4. `pending` nunca se activa. `validated` se activa solo con frase final y registros completos. `academic` se activa solo con el catálogo explícitamente habilitado, texto final y glosa exacta.
5. Los errores deben explicar qué ocurrió y qué puede hacer la persona usuaria.
6. Accesibilidad primero: teclado completo, foco visible, semántica, contraste y texto ampliable.

## Voz

Directa, respetuosa y verificable. Se evitan promesas de traducción completa, tecnicismos innecesarios y mensajes que atribuyan al sistema capacidades no disponibles.

## Límites del MVP

- Reconocimiento offline con Vosk mediante sidecar Python local.
- Sin almacenamiento de audio.
- Sin avatares generativos ni videos de terceros.
- Biblioteca incorporada limitada a 50 clips LSC50 con manifiesto y atribución CC BY 4.0; no constituye traducción gramatical ni contenido validado bajo la política local.
- Importación local de imágenes o clips propios a una carpeta administrada; no se sirven rutas originales ni `file://` arbitrarios.
- Empaquetado de aplicación Electron; Python y el modelo Vosk se preparan por separado según la guía de distribución.

## Antirreferencias

- Interfaces oscuras de consola que dificulten uso prolongado en un aula iluminada.
- Paneles saturados de tarjetas o métricas decorativas.
- Uso de señas, banderas regionales o personas como ornamento sin validación cultural.
- Estados de color sin texto o icono equivalente.
