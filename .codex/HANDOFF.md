# New Conversation Handoff ? FlowMind Feishu IMA

## Read first
1. .codex/EXECUTION_CONTRACT.md
2. .codex/PROJECT_STATE.md
3. .codex/HANDOFF.md
4. .codex/DECISIONS.md
5. .codex/IMA_PARITY.md

## Freshness check
```powershell
Set-Location D:\luxiaofei\ima-feishu
git branch --show-current
git rev-parse --short HEAD
git status --short
Get-FileHash -LiteralPath 'D:\luxiaofei\ima-feishu\app\desktop\out\FlowMind ?? AI ???-1.0.0-x64.exe' -Algorithm SHA256
```
Expected branch: codex/ima-feishu-replica. Expected installer SHA256: 09B243649CEF77D32D5682BDBBF1FF038B54BE05699FE45DDFA96E210F49EF82.

## Current release candidate
- Source: D:\luxiaofei\ima-feishu\app
- Installer: D:\luxiaofei\ima-feishu\app\desktop\out\FlowMind ?? AI ???-1.0.0-x64.exe
- Desktop copy: C:\Users\Administrator\Desktop\FlowMind ?? AI ???-1.0.0-x64.exe
- Installer evidence: evidence/translation-export-installer-acceptance.json (ok=true)
- Browser evidence: evidence/browser/ai-natural-graph-copilot-acceptance.json (ok=true)

## Completed slice
1. Real model-driven chat and visible model failure state.
2. Built-in system prompt plus editable userPrompt/memory separation.
3. Horizontal Copilot memory UI.
4. Explainable semantic Knowledge Graph relations.
5. Evidence-backed chart artifact with persisted sourceRefs and exact anchors.
6. Inline Composer voice transcript insertion with Recording fallback.
7. Smart personalized home/recent-work ranking: deterministic local scoring from actual use, unfinished tasks, followed libraries, dirty drafts and reading positions; recoverable task and cold-start behavior are explicit.
8. Experience continuity polish: global search keeps its result list open (opened rows marked `已打开`) so users can browse multiple results and return; post-sync library selection lands on the library that actually contains documents instead of an empty default.
9. Optional local-first cross-device workspace-state sync core (user-scoped): encrypted pairing relay with revision/CAS writes, three-way merge with explicit conflict choices, tombstones, offline-safe local session, sanitized workspace bundles, and a Settings > Security & Privacy panel. Pure/API fixture tests are green; browser conflict assertion is a known residual and this direction is intentionally not deepened further per user direction.
10. Real-flow daily knowledge loop validation (`daily-knowledge-loop-browser-acceptance.mjs`): sync → read → selection ask → source note autosave → graph freshness → node detail → open note → writing draft with sources → reload recovery; plus a mobile overflow probe at real 390×844.
11. Real external material workflow test (`real-feishu-doc-workflow.test.mjs`) using the user-provided public Feishu doc: real URL parsing (docx token/host), import, search, detail provenance and local grounded summary without a configured model.
12. Sync-OCR completeness fix (`app/server/sync-ocr.mjs`): image attachments from Feishu sync are OCR-extracted into the owning document with stable anchors, original chunks preserved, per-attachment dedupe and warnings; verified by `tests/sync-ocr.test.mjs` and included in `/api/sync` response as `ocrImport`.
13. Real Feishu sync with user-provided credentials (encrypted secret store, default data directory): target document fully absorbed as text (505k chars, 19 sections, versioned), high-intensity verification green (search/relations/graph/summary); model chat surfaced upstream insufficient-balance; 16 media assets blocked by Feishu scope 403 and recorded as `assetWarnings`.

## Immediate action
- Continue deep optimization: problem records, embedded browser clip-to-note, in-note assistant write-back. Do not reset user data.
- Real server may still be on 127.0.0.1:8789 with the user's encrypted credentials.
- Model account balance may still be exhausted; degrade honestly to local retrieval/skill output.

## Latest engineering gates (2026-09-03 Asia/Shanghai)
- `cd app && node --test tests/*.test.mjs`: `783/783`, `skipped 0`.
- AI experience: local fast-replies before model check; stream coalescing (~32ms) on chat/reader/notes/document analysis/Skill; stick-to-bottom scroll; streaming plaintext then Markdown on done.
- Stress: noisy-corpus retrieval P95 < 350ms; parallel Agent isolation; empty retrieval refuses; grounded citations.
- `cd app && npm.cmd run check`: `364/364`, `skipped 0`; Vite production build transformed 2088 modules.
- Sync-OCR tests: `ok=true` (OCR merge into document, searchable with `page:1:region:1` anchor, original chunks retained, repeated sync deduped, OCR-disabled no-op).
- Real external material workflow test: `ok=true`; real Feishu URL parsed/imported/searched with provenance; local summary grounded without model config.
- Existing home ranking, workspace continuity and Evidence continuity browser acceptances: all `ok=true`; overflow 0 and runtime errors 0.
- `npm.cmd run mcp:smoke`: `ok=true`; stdio initialized, 7 tools and 5 resources verified.
- `npm.cmd run desktop:smoke`: host and Electron checks passed, Electron exit code 0.
- `git diff --check` and targeted `node --check` completed without implementation errors; CRLF warnings are pre-existing workspace noise.

The installer/portable release evidence listed above is historical and was not rebuilt in this checkpoint; do not claim a new installer hash from this checkpoint.

## Known open product gaps
- Optional cross-device workspace-state sync: core implemented; `workspace-state-sync-browser-acceptance.mjs` conflict assertion remains a known residual (API/merge tests green).
- The long-term parity contract is still IN PROGRESS; do not claim overall completion.
- Installer/packaged release gates must be rerun after a release-bound code change.
- Keep codex://threads/019fcd30-89d2-77b1-8f89-5381b490c78d separate and paused.
