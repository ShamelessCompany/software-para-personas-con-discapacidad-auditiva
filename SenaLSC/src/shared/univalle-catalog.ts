export interface UnivalleSign {
  classId: string;
  phrase: string;
  slug: string;
  originalPath: string;
  aliases?: readonly string[];
}

export const UNIVALLE_SOURCE = {
  title: "Colombian Sign Language (SLC/csn) Signs Dataset: RGB Video Collection for Sign Classification and Semiotics Research",
  authors: "Juan José Rodriguez-Rodriguez; Wilfredo Alfonso-Morales",
  institution: "Universidad del Valle · Univalle TV",
  year: 2023,
  url: "https://www.kaggle.com/datasets/juanrrai/colombian-sign-language-slc-signs-dataset",
  license: "CC BY-SA 4.0",
  licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
  archiveBytes: 534_576_388,
} as const;

export const UNIVALLE_SIGNS: readonly UnivalleSign[] = [
  { classId: "01", phrase: "Bonito", slug: "bonito", originalPath: "raw/bonito/01_00_000.mp4" },
  { classId: "10", phrase: "Univalle", slug: "univalle", originalPath: "raw/univalle/10_00_000.mp4" },
];
