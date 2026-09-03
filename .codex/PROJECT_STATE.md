# Project State ? FlowMind Feishu IMA

## Status
IN PROGRESS. The current product slices are integrated and the Windows NSIS candidate has historical source checks, browser acceptance, Electron smoke, isolated install/uninstall acceptance, and desktop copy verification. The long-term parity target remains open: optional cross-device workspace sync and other explicitly tracked IMA parity items are not yet closed.

## Canonical workspace
- Path: D:\luxiaofei\ima-feishu
- Branch: codex/ima-feishu-replica
- Paused independent task: codex://threads/019fcd30-89d2-77b1-8f89-5381b490c78d
- Do not touch: D:\luxiaofei\ima-feishu-pdf-backend

## Last verified — 2026-09-03 Asia/Shanghai
- Unit tests: `783/783` passed (`cd app && node --test tests/*.test.mjs`).
- AI smoothness: local fast replies without waiting for a configured model; coalesced streaming; stick-to-bottom transcript; composer 14.5px/72px.
- Real Feishu credentials were configured by the user (App ID `cli_a95378accaf8dcc0`) through the encrypted secret store and a real sync ran against the default data directory (server on 127.0.0.1:8789).
- Real sync result: 12 docx imported (recursive discovery), 1 sheet skipped with an explicit no-permission warning; the target document 【6245】提示词模板汇总 was fully absorbed as text: 190+ blocks, ~505k characters, 19 top-level sections (Ai 智能体模板框架 / 提示词内容模板 / GPT-5 泄露版 / Lyra 元提示词 / Human 3.0 / 提示词母亲 / IP 数字分身与 IP 风格库 / 谷歌 68 页白皮书 / Claude Code / 扎克伯格 CEO Agent 等), version 536 with history, discoveredLinks 7.
- High-intensity verification on real data: search hit 6/6 topic queries; knowledge relations returned topics with full Evidence (evidenceId/version/hash/anchor/current); graph snapshot 36 nodes/41 edges; local summary Skill produced a grounded 1834-char output.
- Reader asset pipeline fixes (2026-08-12, verified in real browser on the 「胶带效果」doc): attachments now match markdown tokens with real Feishu `feishu:image:TOKEN` externalIds; the historical-version endpoint returns attachments/chunks/annotations; tab restoration only uses the historical endpoint for genuinely stale/unavailable tabs so current docs show OCR-merged latest content. Real image (465KB PNG) and file (index.html) render/download; lazy images load on scroll; OCR text renders.
- Three real docs sync test (docx ×2 + wiki ×1): all imported; A-doc（胶带效果, q9m4jbmsly tenant）assets downloaded + OCR imported; B/C external-shared docs keep assetWarnings 403 (cross-tenant media boundary); cross-doc search/DeepSeek Q&A (971 chars, 4 citations)/relations/graph all verified.
- `cd app && npm.cmd run check`: `365/365` tests passed, `0 skipped`.
- Reader asset-placeholder fix: missing Feishu media no longer renders dangling `#missing-feishu-asset` links; images degrade to a one-line notice with the token, files keep their file name, and resolved assets keep pointing at real API URLs (`ContentReader.rewriteFeishuAssetUrls`, contract updated in `content-reader.test.mjs`).
- Test isolation fix: `server.test.mjs` harness now uses temporary Feishu/model secret files instead of the default `runtime-data` paths, because real user credentials were saved there by the real sync (assertions unchanged).
- Real model chat: correctly surfaced upstream `403 INSUFFICIENT_BALANCE` (account balance exhausted) instead of faking an answer; Skill run fell back honestly to the local engine.
- DeepSeek configured and verified live (2026-08-12 20:10+): user-provided key saved encrypted; base `https://sekirocloud.shop/v1`, model `deepseek-v4-flash` (deepseek-chat unsupported by account); real streaming chat + real-model summary Skill verified with citations (`fallbackUsed: false`).
- Feishu media-download scope verified (2026-08-12 20:34): after the user opened all Cloud Docs permissions (`drive:drive` family confirmed live via `drive/v1/metas/batch_query` and `drive/v1/permissions` returning 200), docx image/file assets still return 403. Root cause identified as a platform boundary, not a config issue: the target document is an externally shared doc (`external_access: true`, `share_entity: anyone`, `anyone_readable`), and its embedded media tokens belong to the owning tenant, so a third-party app's tenant token cannot download them cross-tenant. Text content (505k chars) is fully absorbed; media fetch for externally shared docs requires OAuth user identity or documents moved into the app's own tenant.
- Remaining absorption gap: 16 media assets (5 images + 11 files) failed download with `FEISHU_MEDIA_DOWNLOAD_FAILED` 403 — the app lacks the Feishu media-download scope (`drive:drive.readonly`/`drive:drive` plus docs read scopes); this is a Feishu-side permission issue, recorded in `assetWarnings`, not a product failure.
- `cd app && npm.cmd run check`: `364/364` tests passed, `0 skipped`; MCP/Electron smokes green (previous checkpoint baseline unchanged this round).

## Implemented in this checkpoint
- Real-flow validation of the daily knowledge loop (sync → read → selection ask → source note → graph → writing draft → reload recovery) is now a repeatable browser acceptance asset; it confirms the horizontal workspace continuity and evidence chain hold end to end, including mobile 390px without overflow.
- Global search keeps its result list open after opening a result (see previous checkpoint); mobile overflow probe confirms the context drawer is clipped correctly.

Previously implemented capabilities retained:
- Real configured-model chat for greetings and no-hit questions; upstream errors are visible instead of being silently replaced by a fixed retrieval template.
- Client handling for error/model-required/stream interruption/timeout events.
- Copilot userPrompt and memory separation; built-in system rules are not exposed in the UI.
- Horizontal Copilot memory layout; checkbox width is fixed and labels remain horizontal.
- Knowledge Graph semantic edges from shared topics plus relation explanations.
- DeepAnswer process sections are opt-in; empty placeholder synthesis blocks are hidden.
- Evidence-backed chart artifact from DeepAnswer: chartSpec, normalized labels/values, sourceRefs and exact anchors are persisted in notes and rendered beside the answer.
- Inline Composer voice input using SpeechRecognition/WebkitSpeechRecognition; transcript is inserted into the current question and falls back to the existing Recording workspace when browser speech recognition is unavailable.

## Evidence and runnable artifacts
- Source app: D:\luxiaofei\ima-feishu\app
- Home ranking browser fixture: `scripts/acceptance/home-ranking-browser-acceptance.mjs` (temporary state, random port, no real data)
- Stage B Evidence fixture: `scripts/acceptance/evidence-continuity-browser-acceptance.mjs`
- Existing continuity fixtures: `scripts/acceptance/workspace-continuity-browser-acceptance.mjs`, `scripts/acceptance/deep-knowledge-browser-acceptance.mjs`
- Historical natural chat/chart/Copilot browser evidence: `evidence/browser/ai-natural-graph-copilot-acceptance.json`
- Historical installer evidence: `evidence/translation-export-installer-acceptance.json` (not rebuilt in this slice)

## Next action
Continue deep optimization on the existing horizontal workspace. Current slice: problem records, embedded browser clip, and in-note assistant write-back. Landscape research: `research/super-ai-knowledge-base-landscape.md`. Charter: `.codex/DEEP_OPTIMIZATION.md`. The overall FlowMind/IMA/Notion/Obsidian parity target remains IN PROGRESS.

## Known residuals
- The `workspace-state-sync-browser-acceptance.mjs` conflict assertion does not converge on the reading-position expectation in the full browser flow (local edit + remote edit + reopen); the underlying API/merge behavior is green and the sync core is intentionally not deepened further per user direction.
- Installer/portable release evidence is historical and was not rebuilt in this checkpoint.

## Scope lock
- No blog, AI image generation, PPT, discovery plaza, or standalone workbench.
- Keep horizontal workspace, unified Composer, persistent tabs, sourceRefs and exact-anchor return navigation.
- Do not reset user state/content databases.
