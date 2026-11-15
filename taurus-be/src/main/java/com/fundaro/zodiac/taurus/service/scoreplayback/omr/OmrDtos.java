package com.fundaro.zodiac.taurus.service.scoreplayback.omr;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.util.Base64;
import java.util.List;

/** Data exchanged with the OMR service. */
public final class OmrDtos {

    public static final String DONE = "DONE";

    private OmrDtos() {}

    /** A page image sent for recognition, in reading order. */
    public record PageImage(String fileName, String mimeType, byte[] bytes) {}

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record RecognitionResponse(List<EngineResult> results) {}

    /**
     * What one engine read.
     *
     * @param musicXml compressed MusicXML (.mxl) in Base64, present when the engine succeeded
     * @param layout   position of each measure on the pages; {@code null} when the engine does not report it
     */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record EngineResult(
        String engine,
        String version,
        String status,
        String errorCode,
        long durationMillis,
        String musicXml,
        Integer measureCount,
        List<MeasureBox> layout
    ) {
        public boolean succeeded() {
            return DONE.equals(status) && musicXml != null;
        }

        public byte[] musicXmlBytes() {
            return Base64.getDecoder().decode(musicXml);
        }
    }

    /** A measure on a page: page from 1, coordinates as fractions of the page size. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record MeasureBox(int measure, int page, double x, double y, double width, double height, boolean approximate) {}

    /**
     * A part engraved by the music service: the pages as grayscale PNG images at 300 DPI and the vector PDF, both in
     * Base64.
     */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record EngravingResponse(String engine, String version, long durationMillis, int pageCount, String pdf, List<String> pages) {
        public byte[] pdfBytes() {
            return Base64.getDecoder().decode(pdf);
        }

        public List<byte[]> pageBytes() {
            return pages.stream().map(page -> Base64.getDecoder().decode(page)).toList();
        }
    }

    /** The text read on the pages, one entry per page in the order they were sent. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record TextRecognitionResponse(String engine, String version, long durationMillis, List<TextPage> pages) {}

    /** The lines read on a page, from 1, top to bottom and left to right; empty when the page has no text. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record TextPage(int page, List<TextLine> lines) {}

    /**
     * A line read on a page: the rectangle around it as fractions of the page size, the confidence of the engine from 0
     * to 1. The text is untrusted: it is only compared with the names of the instruments.
     */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record TextLine(String text, double confidence, double x, double y, double width, double height) {}
}
