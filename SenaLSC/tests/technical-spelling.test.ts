import { describe, expect, it } from "vitest";
import { matchTechnicalTerm, missingSpellingCharacters, TECHNICAL_TERMS, TechnicalSpellingController } from "../src/shared/technical-spelling";

describe("deletreo técnico", () => {
  it("reconoce los 30 términos requeridos con límites de palabra", () => {
    expect(TECHNICAL_TERMS.slice(0, 30).map((term) => term.label)).toEqual([
      "Python", "JavaScript", "TypeScript", "Java", "HTML", "CSS", "SQL", "Git", "GitHub", "API", "JSON", "React", "Angular", "Node", "Docker", "Linux", "Windows", "variable", "función", "clase", "objeto", "arreglo", "compilador", "servidor", "base de datos", "error", "prueba", "código", "programa", "algoritmo",
    ]);
    expect(matchTechnicalTerm("usamos java script hoy")?.label).toBe("JavaScript");
    expect(matchTechnicalTerm("evite el error")?.label).toBe("error");
    expect(matchTechnicalTerm("esto es reactivo")).toBeNull();
  });

  it("detecta letras o números faltantes antes de activar", () => {
    const letters = new Set("abcdefghijklmnñopqrstuvwxyz".split(""));
    expect(missingSpellingCharacters("python", letters)).toEqual([]);
    expect(missingSpellingCharacters("api2", letters)).toEqual(["2"]);
  });

  it("exige final, descarta otra sesión y aplica cooldown", () => {
    const controller = new TechnicalSpellingController(5_000);
    controller.setSession("asr:2");
    expect(controller.update("Python", false, "asr:2", 1_000)).toBeNull();
    expect(controller.update("Python", true, "asr:1", 1_000)).toBeNull();
    expect(controller.update("Python", true, "asr:2", 1_000)?.label).toBe("Python");
    expect(controller.update("Python", true, "asr:2", 2_000)).toBeNull();
    expect(controller.update("Docker", true, "asr:2", 2_100)?.label).toBe("Docker");
    expect(controller.update("Python", true, "asr:2", 7_000)?.label).toBe("Python");
  });
});
