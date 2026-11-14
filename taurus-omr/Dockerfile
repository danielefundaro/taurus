# Taurus OMR service, the internal music service of Taurus: Audiveris, homr and the RapidOCR text reading, unmodified,
# and the engraving of written parts with Verovio and Cairo, behind an internal HTTP API.
# Every downloaded component is pinned and verified with SHA-256; the models are part of the image, so the service
# never reaches the Internet while running.
FROM ubuntu:24.04

ARG AUDIVERIS_VERSION=5.11.0
ARG AUDIVERIS_SHA256=f20113aaa33b3149ec8d6a09b2a7963360e65fafd92d69389987a85bbc3ec7a3
ARG TESSDATA_TAG=4.1.0

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH=/opt/venv/bin:$PATH \
    PYTHONPATH=/opt/taurus-omr/src \
    TESSDATA_PREFIX=/opt/tessdata \
    TAURUS_OMR_AUDIVERIS_VERSION=${AUDIVERIS_VERSION} \
    TAURUS_OMR_WORK_DIR=/tmp \
    HOME=/tmp

# Audiveris needs GTK and a virtual display even in batch mode; homr needs OpenGL and GLib for OpenCV; the engraving
# needs Cairo and a font with the metrics of Times, the text font of Verovio.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates curl python3 python3-venv \
        xvfb xauth libgtk-3-0t64 libfreetype6 fontconfig fonts-dejavu-core libcairo2 fonts-liberation \
        libx11-6 libxext6 libxrender1 libxtst6 libxi6 libasound2t64 libgl1 libglib2.0-0 \
    && curl -fsSL -o /tmp/audiveris.deb \
        "https://github.com/Audiveris/audiveris/releases/download/${AUDIVERIS_VERSION}/Audiveris-${AUDIVERIS_VERSION}-ubuntu24.04-x86_64.deb" \
    && echo "${AUDIVERIS_SHA256}  /tmp/audiveris.deb" | sha256sum -c - \
    # The package scripts expect a desktop installation: only the files are extracted.
    && dpkg-deb -x /tmp/audiveris.deb / \
    && rm /tmp/audiveris.deb \
    && ln -sf /usr/lib/x86_64-linux-gnu/libgtk-3.so.0 /usr/lib/x86_64-linux-gnu/libgtk-3.so \
    && ln -sf /usr/lib/x86_64-linux-gnu/libgdk-3.so.0 /usr/lib/x86_64-linux-gnu/libgdk-3.so \
    # Tesseract data with the legacy engine, required by Audiveris to read texts such as tempo, "Fine" or endings.
    && mkdir -p /opt/tessdata \
    && for language in eng ita; do \
        curl -fsSL -o "/opt/tessdata/${language}.traineddata" \
            "https://github.com/tesseract-ocr/tessdata/raw/${TESSDATA_TAG}/${language}.traineddata"; \
    done \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt models.sha256 /opt/taurus-omr/
RUN python3 -m venv /opt/venv \
    && pip install --no-cache-dir --upgrade "pip==26.3" \
    # requirements.txt pins every package, so nothing is resolved here. --no-deps lets Pillow 13 in although homr
    # 0.7.0 declares Pillow<13 (see requirements.txt); pip check must report that conflict and nothing else.
    && pip install --no-cache-dir --no-deps -r /opt/taurus-omr/requirements.txt \
    && if ! pip check > /tmp/pip-check.txt; then \
        ! grep -v -i '^homr 0\.7\.0 has requirement pillow<13' /tmp/pip-check.txt; \
    fi \
    && rm -f /tmp/pip-check.txt \
    && homr --init \
    && sha256sum -c /opt/taurus-omr/models.sha256 \
    && apt-get purge -y --auto-remove curl \
    && rm -rf /var/lib/apt/lists/*

COPY src /opt/taurus-omr/src
COPY LICENSE THIRD_PARTY_NOTICES.md /opt/taurus-omr/

RUN useradd --system --no-create-home --shell /usr/sbin/nologin omr
USER omr

EXPOSE 8090
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
    CMD python3 -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8090/v1/health', timeout=4)"
CMD ["uvicorn", "--factory", "taurus_omr.app:create_app", "--host", "0.0.0.0", "--port", "8090", "--log-level", "info"]
