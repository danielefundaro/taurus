from __future__ import annotations

import pytest

from taurus_omr.config import MEGABYTE, ConfigurationError, Settings


def test_reads_the_environment() -> None:
    settings = Settings.from_env(
        {
            "TAURUS_OMR_API_KEY": "k" * 32,
            "TAURUS_OMR_ENGINE_TIMEOUT_SECONDS": "120",
            "TAURUS_OMR_MAX_REQUEST_MB": "5",
            "TAURUS_OMR_HOMR_COMMAND": "python -m homr",
        }
    )

    assert settings.engine_timeout_seconds == 120
    assert settings.max_request_bytes == 5 * MEGABYTE
    assert settings.homr_command == ("python", "-m", "homr")
    assert settings.max_pages == 30
    assert settings.text_concurrency == 1
    assert settings.text_threads == 2
    assert settings.text_timeout_seconds == 60
    assert settings.text_command[1:] == ("-m", "taurus_omr.text")


def test_reads_the_text_reading_settings() -> None:
    settings = Settings.from_env(
        {
            "TAURUS_OMR_API_KEY": "k" * 32,
            "TAURUS_OMR_TEXT_CONCURRENCY": "2",
            "TAURUS_OMR_TEXT_THREADS": "1",
            "TAURUS_OMR_TEXT_TIMEOUT_SECONDS": "30",
            "TAURUS_OMR_TEXT_COMMAND": "python3 -m taurus_omr.text",
        }
    )

    assert (settings.text_concurrency, settings.text_threads, settings.text_timeout_seconds) == (2, 1, 30)
    assert settings.text_command == ("python3", "-m", "taurus_omr.text")


def test_reads_the_engraving_settings() -> None:
    defaults = Settings.from_env({"TAURUS_OMR_API_KEY": "k" * 32})
    settings = Settings.from_env(
        {
            "TAURUS_OMR_API_KEY": "k" * 32,
            "TAURUS_OMR_ENGRAVING_CONCURRENCY": "2",
            "TAURUS_OMR_ENGRAVING_TIMEOUT_SECONDS": "45",
            "TAURUS_OMR_MAX_SCORE_MB": "5",
            "TAURUS_OMR_ENGRAVING_COMMAND": "python3 -m taurus_omr.engrave",
        }
    )

    assert (defaults.engraving_concurrency, defaults.engraving_timeout_seconds, defaults.max_score_bytes) == (1, 120, 20 * 1024 * 1024)
    assert defaults.engraving_command[1:] == ("-m", "taurus_omr.engrave")
    assert (settings.engraving_concurrency, settings.engraving_timeout_seconds, settings.max_score_bytes) == (2, 45, 5 * 1024 * 1024)
    assert settings.engraving_command == ("python3", "-m", "taurus_omr.engrave")


@pytest.mark.parametrize(
    "environ",
    [
        {},
        {"TAURUS_OMR_API_KEY": "short"},
        {"TAURUS_OMR_API_KEY": "k" * 32, "TAURUS_OMR_MAX_PAGES": "0"},
        {"TAURUS_OMR_API_KEY": "k" * 32, "TAURUS_OMR_CONCURRENCY": "two"},
        {"TAURUS_OMR_API_KEY": "k" * 32, "TAURUS_OMR_TEXT_THREADS": "0"},
        {"TAURUS_OMR_API_KEY": "k" * 32, "TAURUS_OMR_ENGRAVING_TIMEOUT_SECONDS": "0"},
    ],
)
def test_refuses_to_start_without_a_valid_configuration(environ: dict[str, str]) -> None:
    with pytest.raises(ConfigurationError):
        Settings.from_env(environ)
