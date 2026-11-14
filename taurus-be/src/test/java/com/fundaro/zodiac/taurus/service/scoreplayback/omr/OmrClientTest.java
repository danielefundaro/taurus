package com.fundaro.zodiac.taurus.service.scoreplayback.omr;

import tools.jackson.databind.ObjectMapper;
import com.fundaro.zodiac.taurus.config.ApplicationProperties;
import com.fundaro.zodiac.taurus.service.scoreplayback.omr.OmrDtos.EngravingResponse;
import com.fundaro.zodiac.taurus.service.scoreplayback.omr.OmrDtos.PageImage;
import com.fundaro.zodiac.taurus.service.scoreplayback.FakeOmrServer;
import com.fundaro.zodiac.taurus.service.scoreplayback.omr.OmrDtos.RecognitionResponse;
import com.fundaro.zodiac.taurus.service.scoreplayback.omr.OmrDtos.TextRecognitionResponse;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Base64;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class OmrClientTest {

    private HttpServer server;
    private final AtomicReference<String> response = new AtomicReference<>();
    private final AtomicReference<Integer> status = new AtomicReference<>(200);
    private final AtomicReference<String> key = new AtomicReference<>();
    private final AtomicReference<String> length = new AtomicReference<>();

    @BeforeEach
    void startServer() throws IOException {
        server = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0);
        server.createContext("/", exchange -> {
            exchange.getRequestBody().readAllBytes();
            key.set(exchange.getRequestHeaders().getFirst(OmrClient.API_KEY_HEADER));
            length.set(exchange.getRequestHeaders().getFirst("Content-Length"));
            byte[] body = response.get().getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(status.get(), body.length);
            exchange.getResponseBody().write(body);
            exchange.close();
        });
        server.start();
    }

    @AfterEach
    void stopServer() {
        server.stop(0);
    }

    @Test
    void sendsThePagesWithTheKeyAndTheirLengthAndReadsTheResults() {
        response.set("""
            {"results":[{"engine":"AUDIVERIS","version":"5.11.0","status":"DONE","errorCode":null,"durationMillis":1500,
            "musicXml":"UEsD","measureCount":34,"layout":[{"measure":1,"page":1,"x":0.1,"y":0.2,"width":0.3,"height":0.05,"approximate":false}],
            "unknown":"ignored"}]}
            """);

        RecognitionResponse result = client("http://127.0.0.1:" + server.getAddress().getPort() + "/").recognize(
            List.of(new PageImage("page-1.png", "image/png", new byte[] { 1, 2, 3 }))
        );

        assertThat(key.get()).isEqualTo("service-key-0123456789");
        assertThat(Long.parseLong(length.get())).isPositive();
        assertThat(result.results()).singleElement().satisfies(engine -> {
            assertThat(engine.succeeded()).isTrue();
            assertThat(engine.measureCount()).isEqualTo(34);
            assertThat(engine.layout()).singleElement().satisfies(box -> assertThat(box.width()).isEqualTo(0.3));
        });
    }

    @Test
    void keepsTheCodesThatDescribeTheInput() {
        status.set(422);
        response.set("{\"code\":\"tooManyPages\",\"message\":\"at most 30 pages\"}");

        assertThatThrownBy(() -> client(url()).recognize(List.of(new PageImage("p.png", "image/png", new byte[] { 1 }))))
            .isInstanceOfSatisfying(OmrException.class, exception -> {
                assertThat(exception.getCode()).isEqualTo("tooManyPages");
                assertThat(exception.isUnavailable()).isFalse();
            });
    }

    @Test
    void reportsEverythingElseAsUnavailable() throws IOException {
        status.set(401);
        response.set("{\"code\":\"unauthorized\"}");
        assertThatThrownBy(() -> client(url()).convertMidi("brano.mid", new byte[] { 1 }))
            .isInstanceOfSatisfying(OmrException.class, exception -> assertThat(exception.isUnavailable()).isTrue());

        status.set(503);
        response.set("{\"code\":\"busy\"}");
        assertThatThrownBy(() -> client(url()).convertMidi("brano.mid", new byte[] { 1 }))
            .isInstanceOfSatisfying(OmrException.class, exception -> assertThat(exception.isUnavailable()).isTrue());

        int closedPort;
        try (ServerSocket socket = new ServerSocket(0, 1, InetAddress.getLoopbackAddress())) {
            closedPort = socket.getLocalPort();
        }
        assertThatThrownBy(() -> client("http://127.0.0.1:" + closedPort).convertMidi("brano.mid", new byte[] { 1 }))
            .isInstanceOfSatisfying(OmrException.class, exception -> assertThat(exception.getCode()).isEqualTo(OmrException.UNAVAILABLE));

        OmrClient unconfigured = client("");
        assertThat(unconfigured.isConfigured()).isFalse();
        assertThatThrownBy(() -> unconfigured.convertMidi("brano.mid", new byte[] { 1 })).isInstanceOf(OmrException.class);
    }

    @Test
    void readsTheTextOfThePages() throws IOException {
        try (FakeOmrServer omr = new FakeOmrServer()) {
            omr.answer("/v1/text-recognitions", 200, "application/json", """
                {"engine":"RAPIDOCR","version":"3.10.0","durationMillis":840,"unknown":"ignored","pages":[
                {"page":1,"lines":[{"text":"Clarinetto 1° in Sib","confidence":0.94,"x":0.05,"y":0.03,"width":0.22,"height":0.02}]},
                {"page":2,"lines":[]}]}
                """);

            TextRecognitionResponse response = client(omr.url()).readText(List.of(
                new PageImage("page-1.png", "image/png", new byte[] { 1, 2 }),
                new PageImage("page-2.png", "image/png", new byte[] { 3 })
            ));

            assertThat(response.engine()).isEqualTo("RAPIDOCR");
            assertThat(response.pages()).hasSize(2);
            assertThat(response.pages().get(0).lines()).singleElement().satisfies(line -> {
                assertThat(line.text()).isEqualTo("Clarinetto 1° in Sib");
                assertThat(line.confidence()).isEqualTo(0.94);
                assertThat(line.width()).isEqualTo(0.22);
            });
            assertThat(response.pages().get(1).lines()).isEmpty();
            assertThat(omr.received()).singleElement().satisfies(received -> {
                assertThat(received.key()).isEqualTo("service-key-0123456789");
                assertThat(Long.parseLong(received.contentLength())).isEqualTo(received.bodySize());
                assertThat(new String(received.body(), StandardCharsets.ISO_8859_1)).contains("filename=\"page-2.png\"");
            });
        }
    }

    @Test
    void readingTheTextWaitsOnlyItsOwnTimeout() throws IOException {
        try (FakeOmrServer omr = new FakeOmrServer()) {
            omr.answerAfter(Duration.ofSeconds(4), "/v1/text-recognitions", 200, "application/json", "{\"pages\":[]}");
            ApplicationProperties properties = properties(omr.url());
            properties.getPdfProcessing().getOcr().setTimeout(Duration.ofSeconds(1));
            OmrClient client = new OmrClient(properties, new ObjectMapper());
            long started = System.nanoTime();

            assertThatThrownBy(() -> client.readText(List.of(new PageImage("page-1.png", "image/png", new byte[] { 1 }))))
                .isInstanceOfSatisfying(OmrException.class, exception -> assertThat(exception.isUnavailable()).isTrue());
            assertThat(Duration.ofNanos(System.nanoTime() - started)).isLessThan(Duration.ofSeconds(4));
        }
    }

    @Test
    void anOlderServiceWithoutTextReadingIsUnavailable() throws IOException {
        try (FakeOmrServer omr = new FakeOmrServer()) {
            assertThatThrownBy(() -> client(omr.url()).readText(List.of(new PageImage("page-1.png", "image/png", new byte[] { 1 }))))
                .isInstanceOfSatisfying(OmrException.class, exception -> assertThat(exception.isUnavailable()).isTrue());
        }
    }

    @Test
    void sendsTheScoreAndTheOptionsAndDecodesTheEngraving() throws IOException {
        try (FakeOmrServer omr = new FakeOmrServer()) {
            String page = Base64.getEncoder().encodeToString(new byte[] { (byte) 0x89, 'P', 'N', 'G' });
            String pdf = Base64.getEncoder().encodeToString("%PDF-1.4".getBytes(StandardCharsets.US_ASCII));
            omr.answer("/v1/engravings", 200, "application/json", """
                {"engine":"VEROVIO","version":"6.4.1","durationMillis":820,"pageCount":2,"pdf":"%s","pages":["%s","%s"],"unknown":"ignored"}
                """.formatted(pdf, page, page));

            EngravingResponse response = client(omr.url()).engrave(
                "parte.mxl",
                "application/vnd.recordare.musicxml",
                new byte[] { 'P', 'K' },
                "{\"format\":\"MARCH\"}"
            );

            assertThat(response.engine()).isEqualTo("VEROVIO");
            assertThat(response.pageCount()).isEqualTo(2);
            assertThat(response.pageBytes()).hasSize(2).first().satisfies(bytes -> assertThat(bytes[1]).isEqualTo((byte) 'P'));
            assertThat(new String(response.pdfBytes(), StandardCharsets.US_ASCII)).startsWith("%PDF-");
            assertThat(omr.received()).singleElement().satisfies(received -> {
                assertThat(received.key()).isEqualTo("service-key-0123456789");
                assertThat(Long.parseLong(received.contentLength())).isEqualTo(received.bodySize());
                String body = new String(received.body(), StandardCharsets.ISO_8859_1);
                assertThat(body).contains("name=\"score\"; filename=\"parte.mxl\"").contains("name=\"options\"").contains("{\"format\":\"MARCH\"}");
            });
        }
    }

    @Test
    void keepsTheCodesThatExplainAFailedEngraving() throws IOException {
        try (FakeOmrServer omr = new FakeOmrServer()) {
            OmrClient client = client(omr.url());
            for (String code : List.of("unreadableScore", "invalidOptions", "tooManyPages")) {
                omr.answer("/v1/engravings", 422, "application/json", "{\"code\":\"" + code + "\"}");
                assertThatThrownBy(() -> client.engrave("parte.musicxml", "application/xml", new byte[] { 1 }, "{}"))
                    .isInstanceOfSatisfying(OmrException.class, exception -> assertThat(exception.getCode()).isEqualTo(code));
            }
            omr.answer("/v1/engravings", 500, "application/json", "{\"code\":\"engineTimeout\"}");
            assertThatThrownBy(() -> client.engrave("parte.musicxml", "application/xml", new byte[] { 1 }, "{}"))
                .isInstanceOfSatisfying(OmrException.class, exception -> assertThat(exception.getCode()).isEqualTo("engineTimeout"));

            omr.answer("/v1/engravings", 503, "application/json", "{\"code\":\"busy\"}");
            assertThatThrownBy(() -> client.engrave("parte.musicxml", "application/xml", new byte[] { 1 }, "{}"))
                .isInstanceOfSatisfying(OmrException.class, exception -> assertThat(exception.isUnavailable()).isTrue());

            // A server error of a recognition never carries the code to the caller.
            omr.answer("/v1/midi-conversions", 500, "application/json", "{\"code\":\"engineFailed\"}");
            assertThatThrownBy(() -> client.convertMidi("brano.mid", new byte[] { 1 }))
                .isInstanceOfSatisfying(OmrException.class, exception -> assertThat(exception.isUnavailable()).isTrue());
        }
    }

    private String url() {
        return "http://127.0.0.1:" + server.getAddress().getPort();
    }

    private static OmrClient client(String url) {
        return new OmrClient(properties(url), new ObjectMapper());
    }

    private static ApplicationProperties properties(String url) {
        ApplicationProperties properties = new ApplicationProperties();
        properties.getOmr().setUrl(url);
        properties.getOmr().setApiKey("service-key-0123456789");
        return properties;
    }
}
