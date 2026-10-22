export interface ExpresaSign {
  identifier: string;
  category: string;
  fileName: string;
  gloss: string;
  aliases?: readonly string[];
}

export const EXPRESA_SOURCE = {
  title: "Colección EXPRESA",
  author: "Jhonny Alejandro Pérez Rojas",
  collaborator: "Luz Adriana Ruiz González",
  organization: "Proyecto EXPRESA",
  location: "Bogotá, Colombia",
  url: "https://archive.org/details/alfabeto_expresa",
  license: "CC BY-NC-ND 3.0 Unported",
  licenseUrl: "https://creativecommons.org/licenses/by-nc-nd/3.0/",
  transformation: "none",
} as const;

const GLOSS = {
  enie: "Ñ", bano: "Baño", cafe: "Café", camara: "Cámara", camion: "Camión",
  corazon: "Corazón", helicoptero: "Helicóptero", lampara: "Lámpara", mama: "Mamá",
  papa: "Papá", reir: "Reír", tecnologia: "Tecnología", telefono: "Teléfono", television: "Televisión",
} as const;

function title(stem: string): string {
  const explicit = GLOSS[stem as keyof typeof GLOSS];
  if (explicit) return explicit;
  const value = stem.replaceAll("_", " ");
  return value.length === 1 ? value.toLocaleUpperCase("es-CO") : `${value[0]?.toLocaleUpperCase("es-CO")}${value.slice(1)}`;
}

function signs(identifier: string, category: string, names: string): ExpresaSign[] {
  return names.split(" ").map((stem) => ({ identifier, category, fileName: `${stem}.mp4`, gloss: title(stem) }));
}

export const EXPRESA_SIGNS: readonly ExpresaSign[] = [
  ...signs("alfabeto_expresa", "alfabeto", "a b c d e enie f g h i j k l m n o p q r s t u v w x y z"),
  ...signs("tecnologia_expresa", "tecnología", "ambulancia aspiradora avion barco bicicleta bus calculadora camara camion carro cd celular computador equipo_de_sonido estufa filmadora helicoptero impresora internet lavadora licuadora microondas moto nevera plancha tecnologia telefono television tren"),
  ...signs("colegio_expresa", "colegio", "amarillo arcoiris azul blanco cero cinco colegio cuatro dos libro marron morado multiplicar naranja negro nueve ocho profesora pupitre restar rojo rosado seis siete sumar tablero tres uno verde"),
  ...signs("hogar_expresa", "hogar", "bano cama cobija cocina cuchara cuchillo dormitorio ducha hijo hogar inodoro lampara lavamanos mama mesa olla papa sala sofa tenedor"),
  ...signs("comidas_bebidas_expresa", "comida y bebida", "agua arroz bebida cafe carne comida huevo jugo leche pan sopa"),
  ...signs("cuerpo_expresa", "cuerpo y acciones", "boca brazo cabeza corazon cuerpo dedo dormir jugar mano nariz ojo pie reir"),
];

export const EXPRESA_ALPHABET = Object.fromEntries(
  EXPRESA_SIGNS.filter((sign) => sign.category === "alfabeto").map((sign) => [sign.gloss.toLocaleLowerCase("es-CO"), sign]),
) as Readonly<Record<string, ExpresaSign>>;
