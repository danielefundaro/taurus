package com.fundaro.zodiac.taurus.service.scoreplayback.omr;

import java.util.Set;

/**
 * The OMR service could not answer. {@link #getCode()} is {@code serviceUnavailable} for network, configuration or
 * capacity problems, otherwise the service code that describes what is wrong with the input.
 */
public class OmrException extends RuntimeException {

    public static final String UNAVAILABLE = "serviceUnavailable";

    /** Service codes about the request content, reported to the user as they are. */
    static final Set<String> INPUT_CODES = Set.of("tooLarge", "tooManyPages", "unreadableImage", "unreadableMidi");

    /**
     * Service codes of an engraving, reported in the job as they are: what is wrong with the score or the options, and
     * an engraving that failed or ran out of time.
     */
    static final Set<String> ENGRAVING_CODES = Set.of("tooLarge", "tooManyPages", "unreadableScore", "invalidOptions", "engineFailed", "engineTimeout");

    private final String code;

    private OmrException(String code, String message) {
        super(message);
        this.code = code;
    }

    public static OmrException unavailable(String message) {
        return new OmrException(UNAVAILABLE, message);
    }

    public static OmrException rejected(String code) {
        return new OmrException(code, "OMR service refused the request: " + code);
    }

    public String getCode() {
        return code;
    }

    public boolean isUnavailable() {
        return UNAVAILABLE.equals(code);
    }
}
