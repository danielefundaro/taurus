package com.fundaro.zodiac.taurus.service.scoreplayback;

import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.w3c.dom.NodeList;
import org.xml.sax.InputSource;
import org.xml.sax.SAXException;

import javax.xml.XMLConstants;
import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import javax.xml.parsers.ParserConfigurationException;
import javax.xml.transform.OutputKeys;
import javax.xml.transform.Transformer;
import javax.xml.transform.TransformerException;
import javax.xml.transform.TransformerFactory;
import javax.xml.transform.dom.DOMSource;
import javax.xml.transform.stream.StreamResult;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.Reader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;

/**
 * Reading and writing of MusicXML files, plain ({@code .musicxml}, {@code .xml}) or compressed ({@code .mxl}).
 * <p>
 * Parsing never resolves external DTDs or entities, and compressed files are bounded in entries and decompressed size.
 * Only {@code score-partwise} documents are supported, the form produced by notation programs and OMR engines.
 */
public final class MusicXmlDocuments {

    public static final String COMPRESSED_MEDIA_TYPE = "application/vnd.recordare.musicxml";
    public static final String PLAIN_MEDIA_TYPE = "application/vnd.recordare.musicxml+xml";

    static final int MAX_ZIP_ENTRIES = 100;
    static final long MAX_DECOMPRESSED_BYTES = 50L * 1024 * 1024;

    private static final String CONTAINER = "META-INF/container.xml";
    private static final String SCORE_ENTRY = "score.musicxml";

    private MusicXmlDocuments() {}

    /** Parses a MusicXML file, compressed or plain, and returns its {@code score-partwise} document. */
    public static Document read(byte[] content) {
        if (content == null || content.length == 0) throw new MusicXmlException("empty");
        byte[] xml = isZip(content) ? scoreFromArchive(content) : content;
        Document document = parse(xml);
        String root = document.getDocumentElement().getTagName();
        if ("score-timewise".equals(root)) throw new MusicXmlException("timewise");
        if (!"score-partwise".equals(root)) throw new MusicXmlException("notMusicXml");
        return document;
    }

    /** Parts declared in {@code part-list}, in order, with their measure count. */
    public static List<PartInfo> parts(Document document) {
        Map<String, Element> partsById = new HashMap<>();
        for (Element part : children(document.getDocumentElement(), "part")) partsById.put(part.getAttribute("id"), part);
        List<PartInfo> result = new ArrayList<>();
        Element partList = child(document.getDocumentElement(), "part-list");
        if (partList == null) return result;
        for (Element scorePart : children(partList, "score-part")) {
            String id = scorePart.getAttribute("id");
            Element part = partsById.get(id);
            if (part == null) continue;
            result.add(new PartInfo(id, text(child(scorePart, "part-name")), children(part, "measure").size()));
        }
        return result;
    }

    /** Ids of the {@code part} elements of the document, in order, also those missing from {@code part-list}. */
    public static List<String> partElementIds(Document document) {
        return children(document.getDocumentElement(), "part").stream().map(part -> part.getAttribute("id")).toList();
    }

    /**
     * Whether the document is written in concert pitch: MusicXML 4.0 marks it with {@code concert-score} in
     * {@code defaults}, as MuseScore reads it.
     */
    public static boolean concertScore(Document document) {
        Element defaults = child(document.getDocumentElement(), "defaults");
        return defaults != null && child(defaults, "concert-score") != null;
    }

    /** A copy of the document that keeps only the given part. */
    public static Document singlePart(Document document, String partId) {
        Document copy = (Document) document.cloneNode(true);
        Element root = copy.getDocumentElement();
        Element partList = child(root, "part-list");
        if (partList != null) {
            for (Element element : childElements(partList)) {
                boolean selected = "score-part".equals(element.getTagName()) && partId.equals(element.getAttribute("id"));
                if (!selected) partList.removeChild(element);
            }
        }
        for (Element part : children(root, "part")) {
            if (!partId.equals(part.getAttribute("id"))) root.removeChild(part);
        }
        return copy;
    }

    /** Compressed MusicXML archive with a single score file. */
    public static byte[] toCompressed(Document document) {
        byte[] xml = toXml(document);
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        try (ZipOutputStream zip = new ZipOutputStream(output)) {
            zip.putNextEntry(new ZipEntry("mimetype"));
            zip.write(COMPRESSED_MEDIA_TYPE.getBytes(StandardCharsets.US_ASCII));
            zip.closeEntry();
            zip.putNextEntry(new ZipEntry(CONTAINER));
            zip.write(("""
                <?xml version="1.0" encoding="UTF-8"?>
                <container><rootfiles><rootfile full-path="%s" media-type="%s"/></rootfiles></container>
                """.formatted(SCORE_ENTRY, PLAIN_MEDIA_TYPE)).getBytes(StandardCharsets.UTF_8));
            zip.closeEntry();
            zip.putNextEntry(new ZipEntry(SCORE_ENTRY));
            zip.write(xml);
            zip.closeEntry();
        } catch (IOException exception) {
            throw new IllegalStateException("Unable to compress MusicXML", exception);
        }
        return output.toByteArray();
    }

    /** UTF-8 serialization of the document, without DOCTYPE. */
    public static byte[] toXml(Document document) {
        try {
            TransformerFactory factory = TransformerFactory.newInstance();
            factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_DTD, "");
            factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_STYLESHEET, "");
            Transformer transformer = factory.newTransformer();
            transformer.setOutputProperty(OutputKeys.ENCODING, StandardCharsets.UTF_8.name());
            transformer.setOutputProperty(OutputKeys.INDENT, "no");
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            transformer.transform(new DOMSource(document), new StreamResult(output));
            return output.toByteArray();
        } catch (TransformerException exception) {
            throw new IllegalStateException("Unable to serialize MusicXML", exception);
        }
    }

    static boolean isZip(byte[] content) {
        return content.length >= 4 && content[0] == 'P' && content[1] == 'K' && content[2] == 3 && content[3] == 4;
    }

    private static byte[] scoreFromArchive(byte[] archive) {
        Map<String, byte[]> entries = new HashMap<>();
        long total = 0;
        int count = 0;
        try (ZipInputStream zip = new ZipInputStream(new ByteArrayInputStream(archive))) {
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                if (++count > MAX_ZIP_ENTRIES) throw new MusicXmlException("archiveTooLarge");
                if (entry.isDirectory()) continue;
                byte[] bytes = readBounded(zip, MAX_DECOMPRESSED_BYTES - total);
                total += bytes.length;
                entries.put(entry.getName(), bytes);
            }
        } catch (IOException exception) {
            throw new MusicXmlException("archive");
        }
        String path = rootFilePath(entries.get(CONTAINER));
        if (path == null) {
            path = entries.keySet().stream()
                .filter(name -> !name.startsWith("META-INF/"))
                .filter(name -> name.toLowerCase(Locale.ROOT).endsWith(".musicxml") || name.toLowerCase(Locale.ROOT).endsWith(".xml"))
                .sorted()
                .findFirst()
                .orElse(null);
        }
        byte[] score = path == null ? null : entries.get(path);
        if (score == null) throw new MusicXmlException("archive");
        return score;
    }

    private static String rootFilePath(byte[] container) {
        if (container == null) return null;
        Document document = parse(container);
        NodeList rootFiles = document.getElementsByTagName("rootfile");
        for (int index = 0; index < rootFiles.getLength(); index++) {
            Element rootFile = (Element) rootFiles.item(index);
            String mediaType = rootFile.getAttribute("media-type");
            if (mediaType.isEmpty() || mediaType.equals(PLAIN_MEDIA_TYPE)) return rootFile.getAttribute("full-path");
        }
        return null;
    }

    private static byte[] readBounded(InputStream input, long remaining) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        long read = 0;
        int chunk;
        while ((chunk = input.read(buffer)) != -1) {
            read += chunk;
            if (read > remaining) throw new MusicXmlException("archiveTooLarge");
            output.write(buffer, 0, chunk);
        }
        return output.toByteArray();
    }

    private static Document parse(byte[] xml) {
        try {
            DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
            factory.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);
            factory.setFeature("http://apache.org/xml/features/nonvalidating/load-external-dtd", false);
            factory.setFeature("http://xml.org/sax/features/external-general-entities", false);
            factory.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
            factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_DTD, "");
            factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_SCHEMA, "");
            factory.setXIncludeAware(false);
            factory.setExpandEntityReferences(false);
            factory.setNamespaceAware(false);
            DocumentBuilder builder = factory.newDocumentBuilder();
            // MusicXML files declare the public DTD: it is never fetched.
            builder.setEntityResolver((publicId, systemId) -> new InputSource(Reader.of("")));
            builder.setErrorHandler(null);
            return builder.parse(new ByteArrayInputStream(xml));
        } catch (SAXException | IOException exception) {
            throw new MusicXmlException("malformed");
        } catch (ParserConfigurationException exception) {
            throw new IllegalStateException("XML parser configuration is not supported", exception);
        }
    }

    static Element child(Element parent, String name) {
        for (Node node = parent.getFirstChild(); node != null; node = node.getNextSibling()) {
            if (node instanceof Element element && element.getTagName().equals(name)) return element;
        }
        return null;
    }

    static List<Element> children(Element parent, String name) {
        List<Element> result = new ArrayList<>();
        for (Node node = parent.getFirstChild(); node != null; node = node.getNextSibling()) {
            if (node instanceof Element element && element.getTagName().equals(name)) result.add(element);
        }
        return result;
    }

    static List<Element> childElements(Element parent) {
        List<Element> result = new ArrayList<>();
        for (Node node = parent.getFirstChild(); node != null; node = node.getNextSibling()) {
            if (node instanceof Element element) result.add(element);
        }
        return result;
    }

    static String text(Element element) {
        return element == null ? null : element.getTextContent().trim();
    }

    /** A part declared in the file. */
    public record PartInfo(String id, String name, int measureCount) {}

    /** The file is not a readable MusicXML score; {@code reason} is a code returned to the client. */
    public static final class MusicXmlException extends RuntimeException {

        private final String reason;

        public MusicXmlException(String reason) {
            super("Invalid MusicXML: " + reason);
            this.reason = reason;
        }

        public String reason() {
            return reason;
        }
    }
}
