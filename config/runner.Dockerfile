FROM mcr.microsoft.com/playwright:v1.63.0-noble
USER root
ARG GRADLE_VERSION=8.14.5
ARG GRADLE_SHA256=6f74b601422d6d6fc4e1f9a1ab6522f642c2fdcbc15ae33ebd30ba3d7198e854
RUN apt-get update \
  && apt-get install -y --no-install-recommends openjdk-21-jdk-headless curl unzip \
  && curl --fail --location --silent --show-error --output /tmp/gradle.zip "https://services.gradle.org/distributions/gradle-${GRADLE_VERSION}-bin.zip" \
  && echo "${GRADLE_SHA256}  /tmp/gradle.zip" | sha256sum --check - \
  && unzip -q /tmp/gradle.zip -d /opt \
  && ln -s "/opt/gradle-${GRADLE_VERSION}/bin/gradle" /usr/local/bin/gradle \
  && rm /tmp/gradle.zip \
  && rm -rf /var/lib/apt/lists/*
RUN npm install -g @anthropic-ai/claude-code@2.1.275 pnpm@11.0.4 @playwright/test@1.63.0
ENV CI=1 PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
USER pwuser
WORKDIR /workspace
