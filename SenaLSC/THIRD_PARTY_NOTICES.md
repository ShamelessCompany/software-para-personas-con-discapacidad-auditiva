# Avisos de terceros

## Motor offline incorporado para Windows

El portable completo incluye Python 3.12.10 embebible x64 oficial de Python Software Foundation, Vosk 0.3.45 y dependencias registradas en PyPI. Todos se distribuyen dentro de un runtime privado, sin instalación global ni descarga durante el uso.

- **Python 3.12.10:** Python Software Foundation License 2.0; fuente oficial `python.org`.
- **Vosk 0.3.45:** Apache License 2.0; Alpha Cephei Inc.; wheel oficial `py3-none-win_amd64` publicado en PyPI.
- **cffi y pycparser:** MIT y BSD-3-Clause, respectivamente.
- **requests, urllib3, certifi, charset-normalizer, idna, tqdm, srt, websockets y colorama:** licencias permisivas conservadas en sus metadatos de distribución.

Versiones, URLs, tamaños y SHA-256 exactos están registrados en `embedded-asr/embedded-asr.manifest.json`. El runtime usa exclusivamente `pythonw.exe`; no expone consola ni depende de Python instalado.

## Colección comunitaria EXPRESA

SenaLSC incluye 129 archivos MP4 originales de la colección EXPRESA en Internet Archive.

- **Autor:** Jhonny Alejandro Pérez Rojas.
- **Colaboración:** Luz Adriana Ruiz González.
- **Organización y lugar:** Proyecto EXPRESA, Bogotá, Colombia.
- **Fuente:** https://archive.org/details/alfabeto_expresa y los identificadores registrados en `assets/lsc/expresa/manifest.json`.
- **Licencia:** CC BY-NC-ND 3.0 Unported, https://creativecommons.org/licenses/by-nc-nd/3.0/

Los archivos se redistribuyen exclusivamente para uso académico/no comercial y sin modificaciones. SenaLSC conserva exactamente sus bytes y nombres: no recorta, convierte, reencodifica, espeja, cambia velocidad, incrusta texto o audio, recombina ni genera miniaturas derivadas. La aplicación reproduce cada original intacto con UI en una superficie separada. El deletreo técnico reproduce secuencialmente un original del alfabeto por letra; no concatena ni genera un video nuevo.

El manifiesto registra identificador, URLs, nombre, tamaño, hashes oficiales y calculados, glosa, categoría, atribución, licencia y `transformation: "none"`. Una colección amplia de signos aislados no equivale a traducción gramatical completa.

## Conjunto académico LSC50

SenaLSC incluye 50 clips seleccionados derivados de *LSC50: Colombian Sign Language Video and Inertial Measurement Dataset* (2024), de Christian Cifuentes-De la Portilla, Luis Felipe Giraldo y Brayan David Solórzano Quevedo.

- **DOI:** https://doi.org/10.6084/m9.figshare.27383016.v1
- **Fuente:** https://figshare.com/articles/dataset/LSC50_Colombian_Sign_Language_Video_and_Inertial_Measurement_Dataset/27383016
- **Licencia:** CC BY 4.0, https://creativecommons.org/licenses/by/4.0/

Se seleccionó una grabación `COLOR_BODY` por clase y se convirtió a MP4 H.264 1280x720, sin recorte, espejo, cambio de velocidad ni bucle. Detalles y hashes: `assets/lsc/lsc50/manifest.json`. El badge académico no afirma validación local por dos personas por clip.

## Corpus cotidiano UniValle

SenaLSC incluye dos adaptaciones canónicas, “Bonito” y “Univalle”, de Juan José Rodriguez-Rodriguez y Wilfredo Alfonso-Morales, *Colombian Sign Language (SLC/csn) Signs Dataset* (2023), Universidad del Valle / Univalle TV.

- **Fuente:** https://www.kaggle.com/datasets/juanrrai/colombian-sign-language-slc-signs-dataset
- **Licencia:** CC BY-SA 4.0, https://creativecommons.org/licenses/by-sa/4.0/

Se seleccionó una toma completa por glosa y se convirtió a MP4 H.264 1280x720 sin recorte, espejo, cambio de velocidad ni bucle. Nueve variantes con concepto equivalente en LSC50 se retiraron del paquete; su hash, fuente, licencia y reemplazo canónico permanecen en `assets/lsc/univalle/manifest.json`. El badge académico no afirma validación local.
