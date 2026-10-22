"""Sidecar local de reconocimiento. Lee PCM por stdin y emite JSON por stdout."""

from __future__ import annotations

import base64
import json
import sys
import time
from pathlib import Path
from typing import Any

SELF_TEST_PROTOCOL_VERSION = 1

ASR_PROFILE_LIGHT = "light"
ASR_PROFILE_PRECISE = "precise"
LANGUAGE_MODE_OPEN = "open-alternatives"

DAILY_GRAMMAR = [
    "gracias", "buenos días", "buenas tardes", "buenas noches", "seña",
    "nombre", "trabajar", "trabajo", "comer", "vivir", "poco", "familia",
    "personas", "mujer", "hombre", "niño", "niña", "abuelo", "tío",
    "hermano", "hambre", "feliz", "contento", "triste", "aburrido", "bien",
    "mal", "cómo estás", "cómo está", "cómo están", "más o menos", "sentir",
    "juicioso", "hola", "adiós", "por favor", "con gusto", "bienvenido",
    "perdón", "permiso", "nunca", "yo", "tú", "ustedes", "qué", "cuándo",
    "dónde", "cómo", "por qué", "quién", "diferente", "todos", "mucho",
    "bonito", "univalle",
]

TECHNICAL_VOCABULARY = [
    "python", "javascript", "typescript", "java", "c plus plus", "c sharp",
    "html", "css", "sql", "git", "github", "api", "json", "react",
    "angular", "node", "node js", "docker", "linux", "windows", "variable", "función",
    "clase", "objeto", "arreglo", "compilador", "servidor", "base de datos",
    "error", "prueba", "código", "programa", "programar", "algoritmo",
]

EXPLICIT_VOCABULARY = tuple(DAILY_GRAMMAR + TECHNICAL_VOCABULARY)


def emit(payload: dict[str, object]) -> None:
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def run_self_test() -> int:
    try:
        from vosk import KaldiRecognizer, Model, SetLogLevel
    except ImportError:
        emit({"type": "error", "message": "Falta la dependencia local vosk."})
        return 4

    if not all(callable(symbol) for symbol in (KaldiRecognizer, Model, SetLogLevel)):
        emit({"type": "error", "message": "La API empaquetada de Vosk no es válida."})
        return 5
    emit({
        "type": "self-test",
        "status": "ok",
        "protocolVersion": SELF_TEST_PROTOCOL_VERSION,
        "engine": "vosk",
    })
    return 0


def contains_explicit_vocabulary(text: str) -> bool:
    normalized = f" {text.casefold().strip()} "
    return any(f" {term.casefold()} " in normalized for term in EXPLICIT_VOCABULARY)


def word_confidence(payload: dict[str, Any]) -> float | None:
    words = payload.get("result")
    if not isinstance(words, list):
        return None
    confidences = [
        float(word["conf"])
        for word in words
        if isinstance(word, dict) and isinstance(word.get("conf"), (int, float))
    ]
    return sum(confidences) / len(confidences) if confidences else None


def choose_alternative(payload: dict[str, Any]) -> tuple[str, float | None]:
    alternatives = payload.get("alternatives")
    if not isinstance(alternatives, list) or not alternatives:
        return str(payload.get("text", "")).strip(), word_confidence(payload)
    valid = [item for item in alternatives if isinstance(item, dict) and isinstance(item.get("text"), str)]
    if not valid:
        return "", None
    highest = max(valid, key=lambda item: float(item.get("confidence", 0.0)))
    highest_confidence = float(highest.get("confidence", 0.0))
    explicit = [
        item for item in valid
        if contains_explicit_vocabulary(str(item["text"]))
        and float(item.get("confidence", 0.0)) >= highest_confidence - 0.015
    ]
    selected = max(explicit, key=lambda item: float(item.get("confidence", 0.0)), default=highest)
    confidence = word_confidence(selected)
    if confidence is None and isinstance(selected.get("confidence"), (int, float)):
        confidence = float(selected["confidence"])
    return str(selected["text"]).strip(), confidence


def last_word_end_ms(payload: dict[str, Any]) -> int | None:
    alternatives = payload.get("alternatives")
    candidates = alternatives if isinstance(alternatives, list) else [payload]
    ends = [
        float(word["end"])
        for candidate in candidates
        if isinstance(candidate, dict)
        for word in candidate.get("result", [])
        if isinstance(word, dict) and isinstance(word.get("end"), (int, float))
    ]
    return round(max(ends) * 1000) if ends else None


class PartialDeduplicator:
    def __init__(self) -> None:
        self.previous = ""

    def accept(self, text: str) -> bool:
        current = text.strip()
        if not current or current == self.previous:
            return False
        self.previous = current
        return True

    def reset(self) -> None:
        self.previous = ""


def create_recognizer(
    model_path: Path,
    sample_rate: int,
    requested_profile: str,
    light_model_path: Path,
) -> tuple[Any, str, Path, str | None, str]:
    from vosk import KaldiRecognizer, Model

    active_profile = requested_profile
    active_path = model_path
    fallback_reason: str | None = None
    try:
        model = Model(str(active_path))
    except Exception as error:
        if requested_profile != ASR_PROFILE_PRECISE or active_path == light_model_path or not light_model_path.is_dir():
            raise error
        active_profile = ASR_PROFILE_LIGHT
        active_path = light_model_path
        fallback_reason = "El modelo preciso falló al cargar; se usará Ligero."
        model = Model(str(active_path))

    recognizer = KaldiRecognizer(model, sample_rate)
    recognizer.SetMaxAlternatives(3)
    language_mode = LANGUAGE_MODE_OPEN
    recognizer.SetWords(True)
    recognizer.SetPartialWords(True)
    return recognizer, active_profile, active_path, fallback_reason, language_mode


def configure_endpointing(recognizer: Any) -> tuple[str, str]:
    set_mode = getattr(recognizer, "SetEndpointerMode", None)
    set_delays = getattr(recognizer, "SetEndpointerDelays", None)
    if not callable(set_mode) or not callable(set_delays):
        return "model-config", "model.conf (Vosk no expone SetEndpointerMode/SetEndpointerDelays)"
    try:
        from vosk import EndpointerMode
        set_mode(EndpointerMode.DEFAULT)
        set_delays(5.0, 0.8, 30.0)
        return "api", "API Vosk: final objetivo tras 0,8 s de silencio"
    except (ImportError, AttributeError, TypeError, ValueError):
        return "model-config", "model.conf (la configuración de endpointing por API no está disponible)"


def result_data(result_json: str) -> tuple[str, float | None]:
    return choose_alternative(json.loads(result_json))


def decoded_result(result_json: str) -> tuple[str, float | None, int | None]:
    payload = json.loads(result_json)
    text, confidence = choose_alternative(payload)
    return text, confidence, last_word_end_ms(payload)


def result_telemetry(
    *,
    kind: str,
    text: str,
    confidence: float | None,
    cause: str,
    first_audio_at_ms: int | None,
    segment_samples: int,
    sample_rate: int,
    last_word_end_ms_value: int | None = None,
) -> dict[str, object]:
    result_at_ms = int(time.time() * 1000)
    segment_duration_ms = round(segment_samples * 1000 / sample_rate)
    return {
        "type": kind,
        "text": text,
        "firstAudioAtMs": first_audio_at_ms,
        "resultAtMs": result_at_ms,
        "latencyMs": None if first_audio_at_ms is None else max(0, result_at_ms - first_audio_at_ms),
        "segmentDurationMs": segment_duration_ms,
        "endpointLatencyMs": None if last_word_end_ms_value is None else max(0, segment_duration_ms - last_word_end_ms_value),
        "cpuTimeMs": round(time.process_time() * 1000),
        "confidence": confidence,
        "cause": cause,
    }


def main() -> int:
    if sys.argv[1:] == ["--self-test"]:
        return run_self_test()
    if len(sys.argv) != 5:
        emit({"type": "error", "message": "Uso: asr.py <modelo> <frecuencia> <perfil> <modelo-ligero>."})
        return 2

    model_path = Path(sys.argv[1])
    if not model_path.is_dir():
        emit({"type": "error", "message": "No se encontró el modelo español de Vosk."})
        return 3

    requested_profile = sys.argv[3]
    light_model_path = Path(sys.argv[4])
    if requested_profile not in (ASR_PROFILE_LIGHT, ASR_PROFILE_PRECISE):
        emit({"type": "error", "message": "El perfil de reconocimiento no es válido."})
        return 2

    try:
        from vosk import SetLogLevel
    except ImportError:
        emit({"type": "error", "message": "Falta la dependencia local vosk."})
        return 4

    SetLogLevel(-1)
    try:
        sample_rate = int(sys.argv[2])
        recognizer, active_profile, active_path, fallback_reason, language_mode = create_recognizer(
            model_path, sample_rate, requested_profile, light_model_path
        )
        endpointing_mode, endpointing = configure_endpointing(recognizer)
    except Exception as error:
        emit({"type": "error", "message": f"No se pudo cargar el modelo Vosk: {error}"})
        return 5
    emit({
        "type": "ready",
        "activeProfile": active_profile,
        "modelName": active_path.name,
        "fallbackReason": fallback_reason,
        "languageMode": language_mode,
        "endpointingMode": endpointing_mode,
        "endpointing": endpointing,
    })

    first_audio_at_ms: int | None = None
    segment_samples = 0
    partials = PartialDeduplicator()
    for line in sys.stdin:
        try:
            message = json.loads(line)
            if message.get("type") == "stop":
                final, confidence, word_end_ms = decoded_result(recognizer.FinalResult())
                if final:
                    emit(result_telemetry(
                        kind="final", text=final, confidence=confidence, cause="stop-flush",
                        first_audio_at_ms=first_audio_at_ms, segment_samples=segment_samples, sample_rate=sample_rate,
                        last_word_end_ms_value=word_end_ms,
                    ))
                return 0
            if message.get("type") != "audio":
                continue
            pcm = base64.b64decode(message["data"], validate=True)
            if len(pcm) % 2:
                raise ValueError("PCM16 desalineado")
            if first_audio_at_ms is None:
                first_audio_at_ms = int(time.time() * 1000)
            segment_samples += len(pcm) // 2
            if recognizer.AcceptWaveform(pcm):
                text, confidence, word_end_ms = decoded_result(recognizer.Result())
                if text:
                    emit(result_telemetry(
                        kind="final", text=text, confidence=confidence, cause="endpoint",
                        first_audio_at_ms=first_audio_at_ms, segment_samples=segment_samples, sample_rate=sample_rate,
                        last_word_end_ms_value=word_end_ms,
                    ))
                first_audio_at_ms = None
                segment_samples = 0
                partials.reset()
            else:
                partial_payload = json.loads(recognizer.PartialResult())
                partial = str(partial_payload.get("partial", "")).strip()
                if partials.accept(partial):
                    confidence = word_confidence({"result": partial_payload.get("partial_result")})
                    emit(result_telemetry(
                        kind="partial", text=partial, confidence=confidence, cause="partial",
                        first_audio_at_ms=first_audio_at_ms, segment_samples=segment_samples, sample_rate=sample_rate,
                    ))
        except (ValueError, KeyError, TypeError) as error:
            emit({"type": "error", "message": f"Bloque de audio inválido: {error}"})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
