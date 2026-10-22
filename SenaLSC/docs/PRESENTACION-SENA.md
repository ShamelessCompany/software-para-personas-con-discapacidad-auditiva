# Presentación del MVP SenaLSC

## Problema

En una clase oral, una persona sorda puede perder información cuando no existe apoyo textual inmediato. Las herramientas en la nube agregan dependencia de Internet y preguntas de privacidad; mostrar señas aisladas sin contexto o validación también puede desinformar.

## Solución

SenaLSC procesa el micrófono localmente, presenta subtítulos españoles grandes y puede asociar una glosa final exacta con un clip local. Mantiene una biblioteca extensible para clips LSC humanos, autorizados, contextualizados y validados. La biblioteca incluida contiene 181 videos/181 conceptos: 50 LSC50, dos UniValle y 129 EXPRESA, con licencias separadas y restricciones académicas/no comerciales para EXPRESA. No afirma traducción automática completa.

## Guion de demostración

1. Abrir En vivo y señalar el estado separado de Python, Vosk y modelo.
2. En Ajustes, activar `Biblioteca LSC`; mantener desactivado el contenido comunitario no comercial si no se han revisado sus condiciones.
3. Si ASR está preparado, seleccionar micrófono, comprobar nivel, iniciar escucha real y decir con una pausa natural: **“Buenos días”**. Verificar el subtítulo abajo y el clip LSC50 arriba con badge `FUENTE ACADÉMICA · LSC50`.
4. Si no hay modelo o micrófono, pulsar `Probar demostración`. El flujo preparado reproduce la misma frase sin usar audio real y puede activar el clip académico porque el catálogo fue habilitado explícitamente.
5. Probar mantener, repetir y ocultar el clip.
6. Abrir Biblioteca visual, buscar una frase, previsualizar un clip e inspeccionar el formulario inline de importación.
7. Abrir Historial, identificar hora y origen, exportar mediante diálogo y limpiar la sesión.
8. Cerrar con el aviso exacto y las limitaciones.

## Alcance

- Arquitectura local ejecutable y empaquetable.
- Captura real de audio con selector y nivel.
- Integración Vosk mediante proceso separado con inicio/parada confirmados y memoria de audio acotada.
- Demostración honesta cuando falta infraestructura.
- Accesibilidad visual y por teclado.
- Biblioteca persistente, protocolo seguro por ID y contrato de metadatos con política `pending|validated|academic`.

## Limitaciones

- Los clips LSC50 son una fuente académica y no cumplen por sí solos la política local de dos validadores individuales por clip.
- El modelo pequeño puede fallar con ruido, nombres propios o vocabulario técnico.
- No reconoce hablantes, no resume y no interpreta intención.
- El portable Windows completo incorpora Python, Vosk, sidecar y modelo Rápido; fue construido e inspeccionado estáticamente desde Linux. La prueba física nativa en Windows x64 con micrófono real sigue pendiente. El desarrollo local Linux admite ASR preparado; el AppImage no dispone de escucha real.
- El portable `SenaLSC Demo` no contiene ASR real y solo demuestra interfaz/frases preparadas.
- No reemplaza servicios de interpretación ni adaptaciones institucionales.

## Siguientes pasos

1. Realizar pruebas de usabilidad con aprendices sordos e instructores.
2. Definir gobernanza y remuneración para validadores de la comunidad sorda.
3. Grabar clips piloto con autorización escrita y diversidad regional documentada.
4. Evaluar precisión con audio real de aulas SENA y vocabulario por programa.
5. Completar la validación física Windows, evaluar firma de instalador y automatización de pruebas; la captura ya usa AudioWorklet.

## Autorización y validación de clips

La autorización debe cubrir imagen, distribución dentro del ejecutable, duración, territorio, modificaciones y retiro. La ficha debe separar quien autoriza el material de quienes validan su adecuación lingüística. Un clip no cambia a `validated` hasta verificar ambos registros.
