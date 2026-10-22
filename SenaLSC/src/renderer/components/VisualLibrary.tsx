import { useEffect, useState, type FormEvent } from "react";
import { MEDIA_SOURCE, MEDIA_STATUS, type MediaLibraryStatus, type VisualLibraryEntry, type VisualMediaDraft } from "../../shared/types";
import { LSC50_SOURCE } from "../../shared/lsc50-catalog";
import { UNIVALLE_SOURCE } from "../../shared/univalle-catalog";
import { EXPRESA_SOURCE } from "../../shared/expresa-catalog";
import { VisualMedia } from "./VisualMedia";

interface VisualLibraryProps {
  entries: VisualLibraryEntry[];
  status: MediaLibraryStatus | null;
  loading: boolean;
  playbackRate: number;
  onChanged: () => Promise<void>;
  onShow: (entry: VisualLibraryEntry) => void;
  onNotice: (message: string, error: boolean) => void;
}

const EMPTY_DRAFT: VisualMediaDraft = {
  label: "",
  phrases: [],
  keywords: [],
  context: "Aula de formación",
  region: "Sin región documentada",
  status: MEDIA_STATUS.PENDING,
  validators: [],
  validationNotes: "",
  license: "",
  authorizationReference: "",
  altText: "",
};

function splitLines(value: string): string[] {
  return value.split("\n").map((item) => item.trim()).filter(Boolean);
}

function EntryPreview({ entry, playbackRate }: { entry: VisualLibraryEntry; playbackRate: number }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void window.senaLsc.getVisualMediaUrl({ id: entry.id }).then((result) => {
      if (!active) return;
      setUrl(result.url);
      setError(result.ok ? null : result.message);
    });
    return () => { active = false; };
  }, [entry.id]);
  if (error) return <p className="media-error" role="alert">{error}</p>;
  if (!url) return <div className="media-placeholder" aria-label="Cargando previsualización" />;
  return <VisualMedia entry={entry} mediaUrl={url} playbackKey={1} playbackRate={playbackRate} compact />;
}

export function VisualLibrary({ entries, status, loading, playbackRate, onChanged, onShow, onNotice }: VisualLibraryProps) {
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [phraseText, setPhraseText] = useState("");
  const [keywordText, setKeywordText] = useState("");
  const [validatorText, setValidatorText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const normalizedSearch = search.trim().toLocaleLowerCase("es-CO");
  const visible = entries.filter((entry) => !normalizedSearch || [entry.label, entry.context, entry.region, ...entry.phrases, ...entry.keywords].join(" ").toLocaleLowerCase("es-CO").includes(normalizedSearch));

  const importMedia = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setSubmitting(true);
    const completeDraft = { ...draft, phrases: splitLines(phraseText), keywords: splitLines(keywordText), validators: splitLines(validatorText) };
    try {
      const result = await window.senaLsc.importVisualMedia({ draft: completeDraft });
      onNotice(result.message, !result.ok && result.message !== "Importación cancelada.");
      if (result.ok) {
        setDraft(EMPTY_DRAFT);
        setPhraseText("");
        setKeywordText("");
        setValidatorText("");
        await onChanged();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const toggleEnabled = async (entry: VisualLibraryEntry): Promise<void> => {
    const result = await window.senaLsc.saveVisualMedia({ entry: { ...entry, enabled: !entry.enabled } });
    onNotice(result.message, !result.ok);
    if (result.ok) await onChanged();
  };

  const deleteEntry = async (entry: VisualLibraryEntry): Promise<void> => {
    const result = await window.senaLsc.deleteVisualMedia({ id: entry.id });
    setConfirmDelete(null);
    onNotice(result.message, !result.ok);
    if (result.ok) await onChanged();
  };

  return (
    <>
      <section className="library-import" aria-labelledby="import-title">
        <div className="library-explanation">
          <p className="eyebrow">IMPORTACIÓN LOCAL SEGURA</p>
          <h2 id="import-title">Agregar imagen o clip propio</h2>
          <p>Se copia a una carpeta administrada. El estado inicial recomendado es Pendiente.</p>
          <p>{status?.message ?? "Consultando almacenamiento local..."}</p>
          <p className="format-note">PNG, JPG, WebP o GIF hasta 15 MB. MP4 o WebM hasta 100 MB.</p>
        </div>
        <form className="import-form" onSubmit={(event) => void importMedia(event)}>
          <label>Etiqueta<input required maxLength={120} value={draft.label} onChange={(event) => setDraft({ ...draft, label: event.target.value })} /></label>
          <label>Frases, una por línea<textarea required rows={3} value={phraseText} onChange={(event) => setPhraseText(event.target.value)} /></label>
          <label>Palabras clave, una por línea<textarea rows={2} value={keywordText} onChange={(event) => setKeywordText(event.target.value)} /></label>
          <label>Contexto<input required maxLength={500} value={draft.context} onChange={(event) => setDraft({ ...draft, context: event.target.value })} /></label>
          <label>Región o variante<input required maxLength={500} value={draft.region} onChange={(event) => setDraft({ ...draft, region: event.target.value })} /></label>
          <label>Texto alternativo<input required maxLength={500} value={draft.altText} onChange={(event) => setDraft({ ...draft, altText: event.target.value })} /></label>
          <label>Estado<select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as VisualMediaDraft["status"] })}><option value={MEDIA_STATUS.PENDING}>Pendiente</option><option value={MEDIA_STATUS.VALIDATED}>LSC validado</option></select></label>
          <label>Validadores, uno por línea<textarea rows={2} value={validatorText} onChange={(event) => setValidatorText(event.target.value)} aria-describedby="validation-help" /></label>
          <label>Autorización o licencia<input value={draft.license} onChange={(event) => setDraft({ ...draft, license: event.target.value })} /></label>
          <label>Referencia de autorización<input value={draft.authorizationReference} onChange={(event) => setDraft({ ...draft, authorizationReference: event.target.value })} /></label>
          <label className="form-wide">Notas de validación<textarea rows={2} value={draft.validationNotes} onChange={(event) => setDraft({ ...draft, validationNotes: event.target.value })} /></label>
          <p id="validation-help" className="form-help form-wide">Para LSC validado se exige autorización o licencia, referencia y al menos dos validadores. La aplicación no verifica por sí sola la calidad lingüística.</p>
          <button className="primary form-wide" type="submit" disabled={submitting || loading}>{submitting ? "Importando..." : "Elegir archivo e importar"}</button>
        </form>
      </section>

      <section aria-labelledby="media-list-title">
        <aside className="academic-credit" aria-labelledby="lsc50-credit-title">
          <div><p className="eyebrow">FUENTE ACADÉMICA · LSC50</p><h2 id="lsc50-credit-title">50 signos aislados de Lengua de Señas Colombiana</h2></div>
          <p>{LSC50_SOURCE.authors} ({LSC50_SOURCE.year}). <cite>{LSC50_SOURCE.title}</cite>. Paper: {LSC50_SOURCE.paperAuthors}. Selección de una toma por clase y conversión/compresión a MP4 H.264, sin recorte, espejo ni cambio de velocidad. No equivale a traducción gramatical de frases ni cumple el requisito local de dos validadores individuales para “LSC validado”.</p>
          <p className="credit-links"><a href={`https://doi.org/${LSC50_SOURCE.doi}`} target="_blank" rel="noreferrer">DOI {LSC50_SOURCE.doi}</a><a href={LSC50_SOURCE.url} target="_blank" rel="noreferrer">Figshare</a><a href={LSC50_SOURCE.licenseUrl} target="_blank" rel="noreferrer">{LSC50_SOURCE.license}</a></p>
        </aside>
        <aside className="academic-credit" aria-labelledby="univalle-credit-title">
          <div><p className="eyebrow">FUENTE ACADÉMICA · UNIVALLE</p><h2 id="univalle-credit-title">2 conceptos únicos de Lengua de Señas Colombiana</h2></div>
          <p>{UNIVALLE_SOURCE.authors} ({UNIVALLE_SOURCE.year}), {UNIVALLE_SOURCE.institution}. <cite>{UNIVALLE_SOURCE.title}</cite>. Se conservan “Bonito” y “Univalle”: una toma completa por glosa, convertida a MP4 H.264 720p sin audio, recorte, espejo ni cambio de velocidad. Nueve variantes duplicadas se omitieron físicamente porque LSC50 aporta el concepto canónico de mayor prioridad; su procedencia permanece registrada en el manifiesto. Las adaptaciones retenidas se distribuyen bajo CC BY-SA 4.0.</p>
          <p className="credit-links"><a href={UNIVALLE_SOURCE.url} target="_blank" rel="noreferrer">Kaggle</a><a href={UNIVALLE_SOURCE.licenseUrl} target="_blank" rel="noreferrer">{UNIVALLE_SOURCE.license}</a></p>
        </aside>
        <aside className="academic-credit community-credit" aria-labelledby="expresa-credit-title">
          <div><p className="eyebrow">LSC COMUNITARIA · EXPRESA</p><h2 id="expresa-credit-title">129 videos originales sin modificaciones</h2></div>
          <p>{EXPRESA_SOURCE.author}, con colaboración de {EXPRESA_SOURCE.collaborator}, {EXPRESA_SOURCE.organization}. Material publicado en {EXPRESA_SOURCE.location}. Uso académico/no comercial bajo {EXPRESA_SOURCE.license}; no se recorta, convierte, reencodifica, espeja, acelera ni combina. Una colección de signos aislados no equivale a traducción gramatical completa.</p>
          <p className="credit-links"><a href={EXPRESA_SOURCE.url} target="_blank" rel="noreferrer">Internet Archive</a><a href={EXPRESA_SOURCE.licenseUrl} target="_blank" rel="noreferrer">{EXPRESA_SOURCE.license}</a></p>
        </aside>
        <div className="library-toolbar"><div><p className="eyebrow">MEDIOS DISPONIBLES</p><h2 id="media-list-title">Biblioteca visual</h2></div><label>Buscar<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Frase, contexto o región" /></label></div>
        {loading ? <p role="status">Cargando biblioteca visual...</p> : visible.length === 0 ? <div className="empty-state"><strong>Sin resultados</strong><p>Pruebe otra búsqueda o importe un medio propio.</p></div> : (
          <div className="library-list">
            {visible.map((entry) => (
              <article key={entry.id} className="library-item">
                <EntryPreview entry={entry} playbackRate={playbackRate} />
                <div className="library-data">
                  <h3>{entry.label}</h3>
                  <p>{entry.phrases.join(" · ")}</p>
                  <dl><div><dt>Contexto</dt><dd>{entry.context}</dd></div><div><dt>Región</dt><dd>{entry.region}</dd></div><div><dt>Validación</dt><dd>{entry.status === MEDIA_STATUS.ACADEMIC ? "Fuente académica; no LSC validado por la política local" : entry.status === MEDIA_STATUS.COMMUNITY ? "Fuente comunitaria atribuida; no LSC validado" : entry.validation.validators.length ? entry.validation.validators.join(", ") : "Sin validadores registrados"}</dd></div><div><dt>Autorización</dt><dd>{entry.authorization.license || "Sin autorización registrada"}</dd></div></dl>
                </div>
                <div className="library-actions">
                  <button className="secondary" onClick={() => onShow(entry)}>Previsualizar arriba</button>
                  <button className="secondary" onClick={() => void toggleEnabled(entry)}>{entry.enabled ? "Deshabilitar" : "Habilitar"}</button>
                  {entry.media.source === MEDIA_SOURCE.IMPORTED && (confirmDelete === entry.id ? <div className="inline-confirm" role="group" aria-label={`Confirmar eliminación de ${entry.label}`}><strong>¿Eliminar archivo local?</strong><button className="danger" onClick={() => void deleteEntry(entry)}>Sí, eliminar</button><button className="secondary" onClick={() => setConfirmDelete(null)}>Cancelar</button></div> : <button className="danger" onClick={() => setConfirmDelete(entry.id)}>Eliminar</button>)}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
