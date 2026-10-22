from __future__ import annotations

import json
import unittest
from unittest.mock import patch

from sidecar import asr


class ResultSelectionTests(unittest.TestCase):
    def test_highest_confidence_wins_without_rewriting(self) -> None:
        text, confidence = asr.choose_alternative({"alternatives": [
            {"text": "texto general", "confidence": 0.91},
            {"text": "texto python", "confidence": 0.80},
        ]})
        self.assertEqual(text, "texto general")
        self.assertAlmostEqual(confidence or 0, 0.91)

    def test_technical_vocabulary_only_breaks_a_narrow_tie(self) -> None:
        text, _ = asr.choose_alternative({"alternatives": [
            {"text": "texto general", "confidence": 0.91},
            {"text": "texto python", "confidence": 0.90},
        ]})
        self.assertEqual(text, "texto python")

    def test_words_produce_average_confidence(self) -> None:
        text, confidence = asr.choose_alternative({
            "text": "hola clase",
            "result": [{"word": "hola", "conf": 0.8}, {"word": "clase", "conf": 1.0}],
        })
        self.assertEqual(text, "hola clase")
        self.assertAlmostEqual(confidence or 0, 0.9)


class TelemetryTests(unittest.TestCase):
    @patch("sidecar.asr.time.time", return_value=12.5)
    def test_stop_flush_telemetry_is_deterministic(self, _time: object) -> None:
        payload = asr.result_telemetry(
            kind="final", text="última frase", confidence=0.75, cause="stop-flush",
            first_audio_at_ms=12_000, segment_samples=16_000, sample_rate=16_000,
        )
        self.assertEqual(payload, {
            "type": "final", "text": "última frase", "firstAudioAtMs": 12_000,
            "resultAtMs": 12_500, "latencyMs": 500, "segmentDurationMs": 1_000,
            "endpointLatencyMs": None, "cpuTimeMs": payload["cpuTimeMs"],
            "confidence": 0.75, "cause": "stop-flush",
        })

    def test_result_data_handles_vosk_json(self) -> None:
        self.assertEqual(asr.result_data(json.dumps({"text": "hola"})), ("hola", None))

    def test_endpoint_latency_uses_last_recognized_word(self) -> None:
        payload = asr.result_telemetry(
            kind="final", text="hola", confidence=0.9, cause="endpoint", first_audio_at_ms=1,
            segment_samples=32_000, sample_rate=16_000, last_word_end_ms_value=1_200,
        )
        self.assertEqual(payload["endpointLatencyMs"], 800)


class StreamingPolicyTests(unittest.TestCase):
    def test_partial_deduplication_never_delays_new_text(self) -> None:
        policy = asr.PartialDeduplicator()
        self.assertTrue(policy.accept("hola"))
        self.assertFalse(policy.accept("hola"))
        self.assertTrue(policy.accept("hola clase"))
        policy.reset()
        self.assertTrue(policy.accept("hola clase"))

    def test_endpointing_falls_back_when_vosk_api_is_missing(self) -> None:
        mode, message = asr.configure_endpointing(object())
        self.assertEqual(mode, "model-config")
        self.assertIn("model.conf", message)

    def test_endpointing_uses_api_when_available(self) -> None:
        class Recognizer:
            def __init__(self) -> None:
                self.delays = None

            def SetEndpointerMode(self, _mode: object) -> None:
                pass

            def SetEndpointerDelays(self, *delays: float) -> None:
                self.delays = delays

        recognizer = Recognizer()
        with patch.dict("sys.modules", {"vosk": type("Vosk", (), {"EndpointerMode": type("Mode", (), {"DEFAULT": 0})})}):
            mode, message = asr.configure_endpointing(recognizer)
            self.assertEqual(mode, "api")
            self.assertIn("0,8 s", message)
        self.assertEqual(recognizer.delays, (5.0, 0.8, 30.0))


if __name__ == "__main__":
    unittest.main()
