# Colaborar con SenaLSC

La aplicación existente vive en `SenaLSC/`. Buscamos mejoras de accesibilidad, pruebas y documentación con participación de personas sordas usuarias de LSC. Es un proyecto académico no oficial, no un intérprete ni una certificación de uso en producción.

## Preparar el entorno

Desde la raíz de su clon o fork, use Node.js 22 o superior y npm 10 o superior:

```bash
cd SenaLSC
npm ci
```

Para reconocimiento real durante el desarrollo local en Linux se requiere Python 3.10–3.12, acceso al micrófono y `unzip`. Prepare el entorno y el modelo pequeño:

```bash
npm run sidecar:setup
npm run model:download
npm run dev
```

`sidecar:setup` crea `.venv/` e instala `sidecar/requirements.txt`; el modelo queda en `models/vosk-model-small-es-0.42/`. Si el Python predeterminado no es compatible, use Python 3.12 explícitamente:

```bash
python3.12 -m venv .venv
.venv/bin/python -m pip install -r sidecar/requirements.txt
SENA_LSC_PYTHON="$PWD/.venv/bin/python" npm run dev
```

El perfil Preciso es opcional: `npm run model:download:large` prepara `models/vosk-model-es-0.42/` y descarga aproximadamente 1,5 GB. Sin Python/Vosk/modelo o micrófono puede probar la demostración rotulada, pero eso no valida reconocimiento real.

El desarrollo Linux admite ASR preparado; el AppImage no dispone de ASR. El portable Windows completo se genera con `npm run package:win:complete`, cuya receta descarga y prepara el runtime en `resources/embedded-asr/`. Ese runtime y los modelos no se versionan. La inspección estática desde Linux no sustituye la validación física pendiente en Windows x64 con voz y micrófono real. Los scripts de entorno anteriores usan sintaxis de shell Linux; no son instrucciones PowerShell.

## Verificar un cambio

La suite incluye una comprobación del runtime Windows generado. Antes de ejecutarla por primera vez, prepare sus requisitos desde `SenaLSC/`:

```bash
npm run model:download
npm run asr:embedded:prepare
```

Estos comandos descargan y verifican el modelo/runtime oficiales; no requieren ejecutar Windows. Sus resultados están ignorados por Git. Sin ellos, la prueba `incluye pythonw PE x64, layout Vosk/DLLs, asr.py y modelo completo` de `tests/package-preflight.test.ts` falla por archivos ausentes. No versionen esos archivos ni omitan la prueba para aparentar un resultado correcto.

Después ejecute, también desde `SenaLSC/`:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

`npm run verify` agrupa esos cuatro controles y `npm run smoke`; no ejecuta benchmarks. `npm run benchmark:audio` y `npm run benchmark:asr` son controles separados, y el segundo requiere el entorno ASR. Consulte [el README de la aplicación](SenaLSC/README.md) y [la validación histórica](SenaLSC/docs/VALIDACION.md) para distinguir pruebas automatizadas, inspección de paquetes y comprobaciones pendientes.

## Proponer una mejora

1. Cree un fork y una rama descriptiva, por ejemplo `feat/mejorar-navegacion-teclado` o `fix/diagnostico-microfono`.
2. Mantenga el cambio enfocado; incluya pruebas cuando cambie comportamiento y actualice la documentación correspondiente.
3. Abra un pull request hacia este repositorio con problema, solución, instrucciones de prueba y resultados reales. Indique sistema operativo, limitaciones y validaciones que no pudo ejecutar; no presente la demostración como prueba de ASR.

Áreas concretas útiles:

- Navegación por teclado, contraste, legibilidad y usabilidad con personas sordas.
- Pruebas físicas Windows de permisos, selección de dispositivo, desconexión y subtítulos reales.
- Diagnóstico de ruido/latencia con consentimiento y evaluación reproducible, sin prometer precisión no medida.
- Revisión lingüística comunitaria, contexto regional y metadatos de autorización de clips.
- Claridad de instalación, licencias y mensajes de error; cobertura de pruebas deterministas.

## Limitaciones conocidas de la entrega inicial

La instalación de dependencias durante la preparación informó 21 avisos npm (11 moderados, 8 altos y 2 críticos). No se actualizaron dependencias en esta importación ni se certificó su seguridad; evalúen los avisos y las actualizaciones compatibles en cambios separados antes de un despliegue de producción. Sigue pendiente la prueba física de Windows con micrófono real. Los tests automatizados no sustituyen esa validación.

## Privacidad y licencias

No suba secretos, archivos `.env`, claves privadas, grabaciones, transcripciones personales, modelos, entornos, dependencias instaladas ni binarios de runtime. Para informar un fallo, use pasos reproducibles y datos sintéticos o anonimizados con consentimiento; no adjunte audio de clase.

La licencia MIT cubre el código, no los videos. Conserve bytes, atribuciones y manifiestos de los medios existentes. EXPRESA es CC BY-NC-ND 3.0, académico/no comercial y sin derivados; LSC50 es CC BY 4.0 y UniValle CC BY-SA 4.0. No reencode, recorte ni sustituya clips para reducir el tamaño del repositorio. Cualquier nuevo medio requiere procedencia, derechos y consentimiento verificables, además de revisión comunitaria; una fuente pública no basta.

Consulte [licencias](SenaLSC/docs/LICENCIAS-TERCEROS.md), [avisos de terceros](SenaLSC/THIRD_PARTY_NOTICES.md), [política de medios](SenaLSC/assets/lsc/README.md) y [privacidad y ética](SenaLSC/docs/PRIVACIDAD-Y-ETICA.md). El logo SENA no acredita respaldo oficial ni autorización de marca; su uso y redistribución quedan sujetos a la autorización correspondiente.
