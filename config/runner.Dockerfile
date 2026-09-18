FROM mcr.microsoft.com/playwright:v1.63.0-noble
RUN npm install -g @anthropic-ai/claude-code@2.1.275 pnpm@11.0.4 @playwright/test@1.63.0
ENV CI=1 PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
USER pwuser
WORKDIR /workspace
