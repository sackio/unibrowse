# Drover worker image: Xvfb + BRANDED google-chrome + a stdlib python driver.
# No node, no extension, no server. Kept small on purpose: Ben wants Drover to
# run "on a small footprint" (#unibrowse-v2 2026-10-24).
#
# Build from the repo root (needs scripts/humanmotion.py):
#   docker build -f drover/worker/Dockerfile -t 192.168.1.207:5050/drover/worker:<tag> .
# ⛔ Push to 192.168.1.207:5050, not .168:32000 (`cluster`, 2026-10-24).
FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive TZ=America/New_York
# tzdata first: without it TZ is accepted and silently ignored
# (chromium-host/Dockerfile.chrome, fault 3).
RUN apt-get update && apt-get install -y --no-install-recommends \
      tzdata ca-certificates curl gnupg \
      xvfb x11-utils xdotool python3 \
      pulseaudio \
      fonts-liberation fonts-noto-core fonts-noto-color-emoji fonts-dejavu-core \
    && curl -fsSL https://dl.google.com/linux/linux_signing_key.pub -o /usr/share/keyrings/google-chrome.asc \
    && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.asc] https://dl.google.com/linux/chrome/deb/ stable main" \
         > /etc/apt/sources.list.d/google-chrome.list \
    && apt-get update && apt-get install -y --no-install-recommends google-chrome-stable \
    && google-chrome --version | tee /etc/drover-chrome-version \
    && apt-get purge -y gnupg && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

RUN useradd -m -u 1000 drover
COPY scripts/humanmotion.py /opt/drover/scripts/humanmotion.py
COPY drover/worker/drover_worker.py /opt/drover/worker/drover_worker.py
USER drover
WORKDIR /home/drover
ENTRYPOINT ["python3", "/opt/drover/worker/drover_worker.py"]
