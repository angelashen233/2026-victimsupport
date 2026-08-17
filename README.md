<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://images.pexels.com/photos/998641/pexels-photo-998641.jpeg" />
</div>

# Safe Harbor

Built for StormHacks 2025

By: Angela Shen, Marcus Chan, Long Nguyen, Edward Lu

View your app in AI Studio: https://ai.studio/apps/drive/1pPbWFmG8YTwj7_8r0-tqlPzbJZMOyb2S

## Run Locally

**Prerequisites:**  Node.js

1. Install dependencies:
   `npm install`
2. Deploy `ai-worker/` (see [ai-worker/README.md](ai-worker/README.md)) and set
   `VITE_AI_WORKER_URL` in [.env.local](.env.local) to its URL. This powers chat,
   incident reports, and resource generation via AWS Bedrock.
3. Run the app:
   `npm run dev`
