"""Settings read from the environment."""

from __future__ import annotations

import os
import shlex
import sys
import tempfile
from dataclasses import dataclass, field

MEGABYTE = 1024 * 1024
MIN_API_KEY_LENGTH = 16


class ConfigurationError(RuntimeError):
    """The service cannot start with the given environment."""


@dataclass(frozen=True)
class Settings:
    """Limits and engine commands of the service.

    The API key is mandatory: the service refuses to start without it, so that it is never exposed unprotected.
    """

    api_key: str
    audiveris_command: tuple[str, ...] = ("xvfb-run", "-a", "/opt/audiveris/bin/Audiveris")
    audiveris_version: str = "5.11.0"
    homr_command: tuple[str, ...] = ("homr",)
    engine_timeout_seconds: int = 300
    max_pages: int = 30
    max_request_bytes: int = 25 * MEGABYTE
    max_midi_bytes: int = 10 * MEGABYTE
    max_image_pixels: int = 60_000_000
    concurrency: int = 1
    # Text reading runs in its own process, with its own slots: it never waits for a recognition.
    text_command: tuple[str, ...] = field(default_factory=lambda: (sys.executable, "-m", "taurus_omr.text"))
    text_concurrency: int = 1
    text_threads: int = 2
    text_timeout_seconds: int = 60
    # Engraving runs in its own process too, with its own slots: a part of a few pages must not wait for a recognition.
    engraving_command: tuple[str, ...] = field(default_factory=lambda: (sys.executable, "-m", "taurus_omr.engrave"))
    engraving_concurrency: int = 1
    engraving_timeout_seconds: int = 120
    max_score_bytes: int = 20 * MEGABYTE
    work_dir: str = field(default_factory=tempfile.gettempdir)

    def __post_init__(self) -> None:
        if len(self.api_key) < MIN_API_KEY_LENGTH:
            raise ConfigurationError(f"TAURUS_OMR_API_KEY must be at least {MIN_API_KEY_LENGTH} characters long")
        for name in (
            "engine_timeout_seconds", "max_pages", "max_request_bytes", "max_midi_bytes", "max_image_pixels", "concurrency",
            "text_concurrency", "text_threads", "text_timeout_seconds", "engraving_concurrency", "engraving_timeout_seconds",
            "max_score_bytes",
        ):
            if getattr(self, name) <= 0:
                raise ConfigurationError(f"{name} must be positive")

    @staticmethod
    def from_env(environ: dict[str, str] | None = None) -> Settings:
        env = os.environ if environ is None else environ
        api_key = env.get("TAURUS_OMR_API_KEY", "")
        values: dict[str, object] = {"api_key": api_key}
        if "TAURUS_OMR_AUDIVERIS_COMMAND" in env:
            values["audiveris_command"] = tuple(shlex.split(env["TAURUS_OMR_AUDIVERIS_COMMAND"]))
        if "TAURUS_OMR_AUDIVERIS_VERSION" in env:
            values["audiveris_version"] = env["TAURUS_OMR_AUDIVERIS_VERSION"]
        if "TAURUS_OMR_HOMR_COMMAND" in env:
            values["homr_command"] = tuple(shlex.split(env["TAURUS_OMR_HOMR_COMMAND"]))
        if "TAURUS_OMR_TEXT_COMMAND" in env:
            values["text_command"] = tuple(shlex.split(env["TAURUS_OMR_TEXT_COMMAND"]))
        if "TAURUS_OMR_ENGRAVING_COMMAND" in env:
            values["engraving_command"] = tuple(shlex.split(env["TAURUS_OMR_ENGRAVING_COMMAND"]))
        integers = {
            "TAURUS_OMR_ENGINE_TIMEOUT_SECONDS": ("engine_timeout_seconds", 1),
            "TAURUS_OMR_MAX_PAGES": ("max_pages", 1),
            "TAURUS_OMR_MAX_REQUEST_MB": ("max_request_bytes", MEGABYTE),
            "TAURUS_OMR_MAX_MIDI_MB": ("max_midi_bytes", MEGABYTE),
            "TAURUS_OMR_MAX_IMAGE_PIXELS": ("max_image_pixels", 1),
            "TAURUS_OMR_CONCURRENCY": ("concurrency", 1),
            "TAURUS_OMR_TEXT_CONCURRENCY": ("text_concurrency", 1),
            "TAURUS_OMR_TEXT_THREADS": ("text_threads", 1),
            "TAURUS_OMR_TEXT_TIMEOUT_SECONDS": ("text_timeout_seconds", 1),
            "TAURUS_OMR_ENGRAVING_CONCURRENCY": ("engraving_concurrency", 1),
            "TAURUS_OMR_ENGRAVING_TIMEOUT_SECONDS": ("engraving_timeout_seconds", 1),
            "TAURUS_OMR_MAX_SCORE_MB": ("max_score_bytes", MEGABYTE),
        }
        for variable, (name, unit) in integers.items():
            if variable in env:
                try:
                    values[name] = int(env[variable]) * unit
                except ValueError as exception:
                    raise ConfigurationError(f"{variable} must be an integer") from exception
        if "TAURUS_OMR_WORK_DIR" in env:
            values["work_dir"] = env["TAURUS_OMR_WORK_DIR"]
        return Settings(**values)  # type: ignore[arg-type]
