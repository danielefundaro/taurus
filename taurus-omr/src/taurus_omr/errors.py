"""Errors returned to the backend as stable codes."""

from __future__ import annotations


class OmrError(Exception):
    """A request the service refuses, answered with an HTTP status and a stable code."""

    status = 422
    code = "invalidRequest"

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class Unauthorized(OmrError):
    status = 401
    code = "unauthorized"


class LengthRequired(OmrError):
    status = 411
    code = "lengthRequired"


class RequestTooLarge(OmrError):
    status = 413
    code = "tooLarge"


class TooManyPages(OmrError):
    status = 422
    code = "tooManyPages"


class UnreadableImage(OmrError):
    status = 422
    code = "unreadableImage"


class UnknownEngine(OmrError):
    status = 422
    code = "unknownEngine"


class UnreadableMidi(OmrError):
    status = 422
    code = "unreadableMidi"


class UnreadableScore(OmrError):
    status = 422
    code = "unreadableScore"


class InvalidOptions(OmrError):
    status = 422
    code = "invalidOptions"


class Busy(OmrError):
    status = 503
    code = "busy"


class EngineFailure(Exception):
    """An engine could not produce a result; the code is reported in the engine result."""

    code = "engineFailed"


class EngineTimeout(EngineFailure):
    code = "engineTimeout"
