# software-para-personas-con-discapacidad-auditiva

Repositorio de Shameless Company para el desarrollo de herramientas tecnologicas de accesibilidad enfocadas en personas sordas o con hipoacusia, orientadas a educacion, trabajo y vida cotidiana.

## Objetivo del repositorio
Construir software practico que elimine barreras de comunicacion en tiempo real mediante subtitulado instantaneo, deteccion visual de alertas sonoras y asistencia en tramites presenciales o virtuales. La meta es crear herramientas que puedan funcionar 100% de forma local en computadores comunes sin requerir conexiones a internet de alta velocidad ni pagar suscripciones de APIs caras, ofreciendo soluciones gratuitas de impacto social y versiones profesionales o paquetes para instituciones educativas y empresas.

---

## Modulos e ideas de proyectos con requisitos de MVP

### 1. Subtitulador flotante en vivo para videollamadas y clases (Offline)
- Que es: Una aplicacion de escritorio con una ventana flotante transparente y personalizable que captura el audio del sistema o del microfono y muestra en pantalla subtitulos palabra por palabra en tiempo real.
- Como genera dinero: Licencias para colegios, universidades o empresas que deben cumplir normativas de accesibilidad e inclusion laboral, o descargas directas en Payhip/itch.io.
- Requisitos de MVP:
  1. Integracion con un motor de reconocimiento de voz local ligero (Whisper.cpp o Vosk en espanol) que funcione en CPUs normales sin tarjeta grafica dedicada.
  2. Captura de audio directo del microfono o del audio interno del PC mediante dispositivo virtual de audio (WASAPI loopback en Windows).
  3. Ventana flotante ("Always on Top") con fondo semitransparente, tamano de letra ajustable y contraste alto para colocarse sobre Zoom, Teams, Google Meet o YouTube.
  4. Latencia menor a 1.5 segundos entre la palabra hablada y la aparicion en pantalla.

### 2. Monitor visual de alertas sonoras del entorno
- Que es: Software que analiza el audio del microfono del computador en segundo plano para identificar sonidos criticos de la casa o la oficina y alertar a la persona mediante senales visuales en la pantalla.
- Como genera dinero: Utilidad de seguridad y autonomia personal comercializable como software descargable para hogar y teletrabajo.
- Requisitos de MVP:
  1. Modelo ligero de clasificacion de audio (usando YAMNet o librerias similares de deteccion de patrones sonoros) entrenado para sonidos clave: timbre de puerta, alarma contra incendios, llanto de bebe o alguien llamando por su nombre.
  2. Notificacion visual no intrusiva pero inconfundible: parpadeo suave en los bordes del monitor (borde rojo para emergencias, borde azul para llamadas o timbres).
  3. Panel de configuracion simple donde el usuario ajusta la sensibilidad del microfono y que alertas desea activar o silenciar.

### 3. Asistente de atencion presencial para mostrador y citas
- Que es: Una interfaz de comunicacion bidireccional en pantalla dividida disenada para usarse en un computador, tablet o celular en consultas medicas, ventanillas de bancos o recepciones.
- Como genera dinero: Se vende como paquete de atencion inclusiva para entidades publicas, consultorios medicos y bancos locales.
- Requisitos de MVP:
  1. Lado A (Funcionario): Boton de microfono que transcribe en texto grande lo que el funcionario dice, sin jerga tecnica y con ortografia corregida.
  2. Lado B (Persona con discapacidad auditiva): Teclado rapido y botones de respuesta frecuente ("Entendido", "Tengo una duda", "Requiero apoyo") con conversion de texto a voz automatica por los altavoces.
  3. Guardar un resumen de texto de la conversacion para que el usuario pueda llevarselo por correo o archivo de texto al finalizar la atencion.

### 4. Extension de navegador para subtitulos forzados universales
- Que es: Extension web (para Chrome, Edge y Firefox) que se engancha al elemento de audio o video de cualquier pagina web (cursos virtuales, grabaciones sin subtitular o audios de mensajeria) y transcribe el contenido al vuelo.
- Como genera dinero: Modelo freemium con version basica gratuita y version Pro con guardado de transcripciones completas en texto y exportacion a PDF.
- Requisitos de MVP:
  1. Extension con permisos de captura de audio de la pestana activa.
  2. Envio del flujo de audio a un servicio local o API ligera serverless que devuelva el texto en fragmentos continuos.
  3. Capa de subtitulo superpuesta sobre el reproductor de video con diseno limpio y controles de pausa.

### 5. Diccionario y visualizador interactivo de Lengua de Senas
- Que es: Aplicacion interactiva con buscador de palabras comunes y terminos tecnicos que muestra la seña correspondiente en video o modelo 3D paso a paso.
- Como genera dinero: Material educativo para instituciones que ensenan lengua de señas y para personas oyentes que trabajan con comunidades sordas.
- Requisitos de MVP:
  1. Base de datos SQLite local con al menos 150 señas basicas en video corto optimizado (menos de 500 KB por clip).
  2. Buscador en tiempo real por palabra, categoria (saludos, tecnologia, emergencias, numeros) o letra.
  3. Reproductor con control de velocidad lenta (0.5x) y bucle para facilitar el aprendizaje visual.
