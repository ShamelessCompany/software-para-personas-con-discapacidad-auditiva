# Diseño de SenaLSC

## Escena de uso

Una persona aprendiz consulta un portátil Windows en un aula iluminada mientras mantiene atención alternada entre el instructor y la pantalla. La interfaz debe ser estable, silenciosa y legible desde una distancia mayor a la habitual.

## Estrategia visual

Registro `product` y estrategia de color `Restrained`. Superficies claras con neutros inclinados al verde, texto carbón y verde SENA solo para marca, acciones primarias, foco, progreso y estados positivos. El color ocupa menos del 10% de la consola. No se usan gradientes, glows, glassmorphism, ruido, parallax, animación decorativa ni tarjetas anidadas.

## Tokens

- Verde SENA medido del PNG: `#1A8545`, equivalente a `oklch(54.37% 0.1349 151.45)`.
- Verde oscuro para hover, texto sobre fondo claro y CTA: `#0F5C2D`, equivalente a `oklch(41.84% 0.1047 151.04)`.
- Verde claro de estado y superficie: `#E7F3E9`, equivalente a `oklch(95.24% 0.0183 150.55)`.
- Fondo: `#F7FAF5`, equivalente a `oklch(98.15% 0.0073 132.41)`.
- Superficie: `#F9FBF7`, equivalente a `oklch(98.55% 0.0057 128.52)`.
- Texto: `#1C261F`, equivalente a `oklch(25.65% 0.0192 154.35)`.
- Texto secundario: `#526158`, equivalente a `oklch(47.70% 0.0233 159.06)`.
- Error: `#A7473D`, equivalente a `oklch(52.22% 0.1289 28.27)`.
- Advertencia: ámbar reservado para permiso, prueba o carga real. Azul no forma parte de la interfaz operativa.
- Radio principal: `12px`
- Foco: contorno sólido de `3px`, separado `3px`.

Contrastes medidos: texto/fondo 14,82:1; texto secundario/fondo 6,22:1; blanco cálido/verde oscuro 7,79:1; blanco cálido/verde medido 4,50:1. El verde medido como texto sobre fondo alcanza 4,45:1 y se reserva para texto grande o elementos no textuales; el texto pequeño usa verde oscuro.

## Tipografía

Pila local: `Aptos`, `Segoe UI Variable`, `Segoe UI`, `Ubuntu`, `Cantarell`, `system-ui`, `sans-serif`. No se descargan fuentes. Escala fija para que el aumento de texto sea predecible. Los párrafos se limitan a 65–75 caracteres; subtítulos entre 28 y 72 px; controles a partir de 14 px con áreas interactivas mínimas de 44 px.

## Estructura

- Cabecera compacta con el logo PNG suministrado, nombre, descriptor y estado residente.
- Navegación por pestañas semánticas: Activación, Historial, Biblioteca visual y Preferencias.
- Activación es una consola operativa, no un dashboard: CTA dominante, explicación de bandeja y tres secciones consecutivas para micrófono, motor offline y apoyo visual.
- El CTA y el selector de micrófono permanecen visibles en 1280 × 720 y 1366 × 768. La vista previa se revela progresivamente y no compite con la activación.
- Una sola Biblioteca LSC controla los 181 videos/181 conceptos canónicos. Contenido comunitario no comercial y deletreo son subopciones legales; cada entrada conserva fuente, licencia y política visibles.
- El apoyo visual aparece como una franja contextual con medio, motivo de coincidencia y acciones mantener, repetir u ocultar. No compite con el subtítulo.
- Los subtítulos aparecen en una barra compacta de máximo dos líneas, configurable como `Arriba`, `Abajo` o `Flotante`. La posición vertical flotante se ajusta desde la app principal sin volver interactiva la superficie residente. El medio aparece pequeño arriba a la derecha, separado de la barra superior, y conserva su badge superpuesto dentro del contenido.
- La Biblioteca visual usa formulario inline, búsqueda y lista; no usa modal ni tarjetas anidadas.

## Componentes

- Botones con una sola gramática: primario sólido, secundario de superficie y peligro con texto explícito.
- Estados expresados con icono, texto y tono; nunca solo color.
- Formularios con etiqueta visible y ayuda asociada cuando sea necesaria.
- Tablas y listas separadas por líneas suaves, sin tarjetas anidadas.
- Esqueletos solo durante cargas perceptibles; no se usan animaciones decorativas.
- Las imágenes usan `object-fit: contain`, texto alternativo y fondo de alto contraste. Los videos se reproducen una vez, sin audio y sin loop, con controles compactos de pausa y repetición.
- Iconografía funcional basada en signos tipográficos simples y el logo original. No se fabrican SVG ni símbolos de marca alternativos.
- El logo se usa como identidad de un `Proyecto académico SENA`; no se presenta como aplicación oficial ni como marca de contenido LSC.

## Estados

La consola cubre con icono, etiqueta y explicación: Listo, Solicitando permiso, Sin micrófono, Audio detectado, Motor cargando, Escuchando, Pausado y Requiere atención. El verde indica disponibilidad o confirmación, el ámbar procesos pendientes y el rojo errores recuperables.

## Overlays

- Subtítulos: blanco cálido sobre carbón semitransparente, máximo dos líneas, con estado, indicador local y micrófono en una franja secundaria. Verde SENA solo en el estado; el texto reconocido domina.
- Video: 280 × 210 px base con clamp 240–360 px, esquina superior derecha del monitor activo y margen de 20–28 px. Usa `object-fit: contain`, fondo carbón discreto y badges pequeños; ningún panel tapa manos o rostro.
- Ambos BrowserWindow conservan transparencia total de raíz, ausencia de marco/sombra/foco, `alwaysOnTop` y click-through. Subtítulo y video pueden coexistir sin cambio de lógica.

## Movimiento

Transiciones de estado de 160 ms con salida exponencial. Se eliminan con `prefers-reduced-motion`. No hay secuencias de entrada ni desplazamientos automáticos invasivos.

## Adaptación

La ventana principal funciona desde 860 × 640 px y se comprueba a 1280 × 720, 1366 × 768 y 1920 × 1080. A 1100 px, apoyo visual ocupa una fila completa; a 680 px, todas las secciones fluyen en una columna. El contenido usa desplazamiento vertical interno y no presenta scroll horizontal. Admite zoom al 200% sin pérdida de controles. Las superficies residentes se calculan en DIPs, siguen el monitor activo y su `workArea`, responden a cambios de escala/pantalla y no capturan clics.
