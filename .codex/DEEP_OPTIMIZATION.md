# Deep Optimization Charter — FlowMind

Status: IN PROGRESS. This is the working contract for structural and experience optimization. Do not claim the product is finished.

## User-locked product decisions (2026-08-25)

1. Keep the FlowMind shell: 240px/icon rail, single Composer, persistent tabs, Context overlay, existing primary nav (收集 / 知识库 / 笔记 / Copilot). Do not add plaza, blog, image gen, PPT, or a standalone workbench.
2. Learn comfortable layout, settings grouping, Q&A notes, and document reading/editing rhythm from [happy-friday-lite](https://github.com/cheney-plus/happy-friday-lite) by observable UX, implemented independently. Do not import their brand or repo as a dependency.
3. 「问题记录」 is a new note type (`artifactKind: 'problem'`). Existing notes stay openable and unchanged.
4. Embedded web browser in a workspace tab. After reading, clip URL / title / excerpt / selection into the current or a new problem note, preserving sourceRefs.
5. Knowledge precipitation in the AI era: record the exception, not the encyclopedia. Example: do not rewrite 西红柿炒鸡蛋; record 「老是忘记放葱花」.

## Why experience feels poor

The product already has sync, search, RAG-ish retrieval, notes, MCP and desktop packaging. The pain is structure:

- Giant `App`/`main.jsx` orchestration
- Dual persistence (JSON `state.json` + SQLite)
- Session, command, and layout mixed into UI components

Target layers (extract incrementally, do not rewrite in one shot):

1. Workspace — tabs, recent work, reading positions
2. Session — chat/reader/note scene without message bodies
3. Command — Ctrl+K and in-surface actions
4. Layout — shell, density, settings groups
5. Artifact — notes, problem records, writing, sourceRefs
6. Provider — models, Feishu, web clip, MCP

## Non-negotiables

- SQLite/FTS remains the content source of truth. No parallel index for the same documents.
- Credentials stay server-side AES-256-GCM. Never log, evidence, API-return, or commit secrets.
- sourceRefs + exact-anchor return navigation stay mandatory.
- Do not reset user runtime-data or content databases.
- Honest degradation: blocked embeds, private URLs, and missing Feishu media must be visible, not faked.
- Completion language gate: no evidence, no “done”.

## Slice order

1. Settings / reading / note density (Friday-inspired, FlowMind shell kept)
2. Problem-record type + Q&A editor, coexist with notes
3. Embedded browser + clip into problem records
4. In-note agent write-back without copy-paste
5. RAG hit-window / citation comfort on existing FTS
6. Extract Workspace/Session/Command layers out of `main.jsx`

## External landscape

See `research/super-ai-knowledge-base-landscape.md`. Learn interaction, not product identity.
