import test from 'node:test';
import assert from 'node:assert/strict';
import { displayTitle, hasBrokenEncoding, humanizeSourceLabel, sanitizeDisplayText, searchResultTitle, searchResultType } from '../src/workspace/display-text.js';
import { appendWikiLinksToNote, applyAssistantAnswerToProblemNote, buildSourceNoteContent, buildSourceNoteTitle, extractPitfallFromAnswer, extractSpokenPitfall, findRelatedProblemNote, isPitfallAppendQuestion, isProblemNote, mergeProblemNoteContent, noteHasSubstance, noteHasVisibleRelations, noteListAnswerPreview, noteListPreview, noteListQuestion, parseQaNote, pickOpenNote, plainPreview, problemNoteDraft, searchExcerptPreview, serializeQaNote, wikiLinksFromSourceRefs } from '../src/workspace/note-capture.js';

test('broken encoding titles are not shown as first-class labels', () => {
  assert.equal(hasBrokenEncoding('标签验证文档'), false);
  assert.equal(hasBrokenEncoding(`��签�证�档`), true);
  assert.equal(displayTitle(`��签�证�档`), '未命名文档');
  assert.equal(sanitizeDisplayText('ô', { fallback: '继续上次对话' }), '继续上次对话');
  assert.equal(sanitizeDisplayText('继续上次对话', { fallback: '继续上次对话' }), '继续上次对话');
  assert.equal(humanizeSourceLabel('local'), '本地');
  assert.equal(humanizeSourceLabel('feishu'), '飞书');
});

test('source notes start as a writing surface instead of an empty template', () => {
  assert.equal(buildSourceNoteTitle({ title: 'Agent Loop：从长时运行幻觉到可验证的责任闭环' }), '阅读 · Agent Loop：从长时运行…');
  assert.equal(buildSourceNoteContent({ title: '季度策略' }), '');
  assert.equal(
    buildSourceNoteTitle({ title: '季度策略' }, { selection: { quote: '增长来自复购' } }),
    '选区 · 季度策略'
  );
  assert.equal(buildSourceNoteContent({ title: '季度策略' }, { quote: '增长来自复购' }), '> 增长来自复购\n\n');
  assert.doesNotMatch(buildSourceNoteContent({ title: '季度策略' }), /## 摘要|## 关键观点|## 行动项/);
});

test('note list preview skips empty template chrome', () => {
  assert.equal(noteListPreview('# 标题\n\n## 摘要\n\n## 关键观点\n\n- \n\n## 行动项\n\n- [ ] '), '标题 摘要 关键观点 行动项');
  assert.equal(noteListPreview(''), '空白笔记');
  assert.equal(plainPreview('## 学完你应该获得什么\n\n- 理解上下文隔离'), '学完你应该获得什么 理解上下文隔离');
  assert.equal(plainPreview('****公益性质****的交流群'), '公益性质的交流群');
  assert.doesNotMatch(plainPreview('视频教程 [!NOTE] 【第126期】'), /\[!NOTE\]|\*\*/);
  assert.match(plainPreview('视频教程 [!NOTE] 【第126期】'), /第126期/);
  assert.equal(plainPreview(''), '');
  assert.equal(
    searchExcerptPreview('Agent Loop：从长时运行幻觉到可验证的责任闭环\n## 学完你应该获得什么\n\n- 理解上下文隔离', {
      title: 'Agent Loop：从长时运行幻觉到可验证的责任闭环'
    }),
    '学完你应该获得什么 理解上下文隔离'
  );
  assert.doesNotMatch(searchExcerptPreview('## 学完你应该获得什么\n\n**公益性质**'), /##|\*\*/);
  assert.doesNotMatch(
    searchExcerptPreview('对照 [[Agent Loop：从长时运行幻觉到可验证的责任闭环]] 和 [[Hermes Agent]]'),
    /\[\[|\]\]/
  );
  assert.match(searchExcerptPreview('对照 [[Agent Loop：从长时运行幻觉到可验证的责任闭环]]'), /Agent Loop/);
  assert.equal(searchResultTitle('????????,?? Hermes Agent'), 'Hermes Agent');
  assert.equal(searchResultTitle('????????'), '未命名内容');
  assert.equal(searchResultTitle('活动文档坞验收'), '活动文档坞验收');
  assert.equal(searchResultType({ type: 'note' }), 'note');
  assert.equal(searchResultType({ kind: 'conversation' }), 'conversation');
  assert.equal(searchResultType({ itemType: 'note' }), 'note');
  assert.equal(searchResultType({ type: 'pdf', kind: 'document' }), 'document');
  assert.equal(searchResultType({ sourceType: 'local-note' }), 'document');
  assert.equal(noteHasVisibleRelations({ sourceRefs: [{ documentId: 'doc-1' }] }), true);
  assert.equal(noteHasVisibleRelations({}), false);
});

test('opening notes skips blank untitled drafts', () => {
  const blank = { id: 'n1', title: '无标题笔记', content: '' };
  const olderBlank = { id: 'n2', title: '无标题笔记', content: '   ' };
  const real = { id: 'n3', title: '日常路径走查笔记', content: '从搜索打开笔记后写下这一段。' };
  assert.equal(noteHasSubstance(blank), false);
  assert.equal(noteHasSubstance(real), true);
  assert.equal(pickOpenNote([blank, olderBlank, real]).id, 'n3');
  assert.equal(pickOpenNote([blank, real], { preferredId: 'n1' }).id, 'n1');
});

test('problem notes present as question, resolution and next-time pitfall', () => {
  const draft = problemNoteDraft({ question: '西红柿炒鸡蛋总是忘放葱花', pitfall: '出锅前再看一眼葱花' });
  assert.equal(draft.artifactKind, 'problem');
  assert.ok(draft.tags.includes('问题记录'));
  const qa = parseQaNote(draft.content);
  assert.equal(qa.question, '西红柿炒鸡蛋总是忘放葱花');
  assert.equal(qa.pitfall, '- 出锅前再看一眼葱花');
  assert.equal(parseQaNote('## 问题\n忘了\n\n## 这次怎么解决的\n\n## 下次容易忘的点\n- 葱花').resolution, '');
  assert.equal(parseQaNote('## 问题\n忘了\n\n## 这次怎么解决的\n\n## 下次容易忘的点\n- 葱花').pitfall, '- 葱花');
  assert.match(serializeQaNote(qa), /## 问题/);
  assert.equal(parseQaNote(problemNoteDraft().content).pitfall, '');
  const extraNote = parseQaNote(`${draft.content}\n\n## 关联资料\n- 菜谱文档`);
  assert.equal(extraNote.extra.includes('关联资料'), true);
  assert.match(serializeQaNote(extraNote), /## 关联资料/);
  const note = { ...draft, artifactKind: 'problem' };
  assert.equal(isProblemNote(note), true);
  assert.equal(noteListQuestion(note), '西红柿炒鸡蛋总是忘放葱花');
  assert.match(noteListAnswerPreview(note), /葱花/);
});

test('assistant write-back keeps extra sections and records the pitfall, not the encyclopedia', () => {
  const content = [
    '## 问题',
    '西红柿炒鸡蛋总是忘放葱花',
    '',
    '## 这次怎么解决的',
    '出锅前再看一眼葱花',
    '',
    '## 下次容易忘的点',
    '- 把这次容易漏掉的步骤记下来，而不是整篇答案。',
    '',
    '## 关联资料',
    '- 菜谱文档'
  ].join('\n');
  const next = applyAssistantAnswerToProblemNote({
    content,
    answer: '可以先炒蛋再下番茄。\n下次容易忘：出锅前再看一眼葱花'
  });
  assert.match(next, /## 关联资料/);
  assert.match(next, /出锅前再看一眼葱花/);
  assert.doesNotMatch(next, /把这次容易漏掉的步骤记下来/);
  const again = applyAssistantAnswerToProblemNote({
    content: next,
    answer: '可以先炒蛋再下番茄。\n下次容易忘：出锅前再看一眼葱花'
  });
  assert.equal(parseQaNote(again).pitfall.split('葱花').length - 1, 1);
  assert.equal(extractPitfallFromAnswer('下次容易忘：出锅前再看一眼葱花'), '出锅前再看一眼葱花');
  assert.equal(extractPitfallFromAnswer('- 出锅前再看一眼葱花'), '出锅前再看一眼葱花');
  assert.equal(
    extractPitfallFromAnswer('西红柿炒鸡蛋要先炒蛋再下番茄，火候和盐都要按口味调整，最后盛盘前再检查一遍配菜是否齐全。'),
    ''
  );
});

test('similar problem notes merge and grow wiki links instead of duplicating', () => {
  const first = problemNoteDraft({ question: '西红柿炒鸡蛋总是忘放葱花', pitfall: '出锅前再看一眼葱花' });
  const second = problemNoteDraft({ question: '西红柿炒鸡蛋总是忘放葱花？', pitfall: '蛋液里先加点盐' });
  const related = findRelatedProblemNote([{ id: 'n1', ...first }], { question: second.title });
  assert.equal(related.id, 'n1');
  const merged = mergeProblemNoteContent(first.content, second.content);
  assert.match(merged, /出锅前再看一眼葱花/);
  assert.match(merged, /蛋液里先加点盐/);
  assert.deepEqual(wikiLinksFromSourceRefs([{ title: '家常菜谱' }, { title: '家常菜谱' }, { url: 'https://example.com', title: '网页' }]), ['[[家常菜谱]]']);
  const linked = appendWikiLinksToNote(merged, [{ title: '家常菜谱' }]);
  assert.match(linked, /\[\[家常菜谱\]\]/);
  assert.equal(findRelatedProblemNote([{ id: 'n2', title: '发布清单', content: '审批', tags: ['发布'] }], { question: '西红柿炒鸡蛋总是忘放葱花' }), null);
});

test('spoken pitfall lines extract a short step instead of a whole answer', () => {
  assert.equal(isPitfallAppendQuestion('再补：蛋液加点盐'), true);
  assert.equal(isPitfallAppendQuestion('再记一点'), true);
  assert.equal(isPitfallAppendQuestion('把这个记下来'), true);
  assert.equal(isPitfallAppendQuestion('再补一段对比分析'), false);
  assert.equal(isPitfallAppendQuestion('下次记得放葱花'), true);
  assert.equal(isPitfallAppendQuestion('对了，下次别忘了放葱花'), true);
  assert.equal(isPitfallAppendQuestion('下次记得审批闸门是谁'), false);
  assert.equal(extractSpokenPitfall('下次记得放葱花'), '放葱花');
  assert.equal(extractSpokenPitfall('再补：蛋液加点盐'), '蛋液加点盐');
  assert.equal(extractSpokenPitfall('再记一点', '可以先炒蛋。\n下次容易忘：出锅前再看一眼葱花'), '出锅前再看一眼葱花');
});
