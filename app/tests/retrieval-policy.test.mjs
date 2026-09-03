import test from 'node:test';
import assert from 'node:assert/strict';
import { distinctiveQueryPhrases, expandQueryAliases, relaxedTitleSearch, searchDocuments, softenRetrievalQuery } from '../server/retrieval.mjs';
import {
  EMPTY_RETRIEVAL_ANSWER,
  conversationFastReply,
  emptyRetrievalDecision,
  emptyRetrievalRelations,
  expandRetrievalQuery,
  isAnswerTransformQuestion,
  isConfirmationApproval,
  isConfirmationRejection,
  isConfirmationReply,
  isConversationOnlyQuestion,
  isFollowUpQuestion,
  isArtifactWorkQuestion,
  isHowToWriteQuestion,
  isOpenLastWrittenQuestion,
  isOrphanFollowUp,
  isSoftConfirmationApproval,
  isTransformableAssistantAnswer,
  resolveReaderAskLock,
  shouldIncludeKnowledgeBase,
  AGENT_QUESTION_MAX_CHARS,
  agentRunNeedsKnowledgeScan,
  shouldRetrieveKnowledge
} from '../server/retrieval-policy.mjs';

test('only greetings and capability questions skip retrieval', () => {
  assert.equal(isConversationOnlyQuestion('你好'), true);
  assert.equal(isConversationOnlyQuestion('你是谁？'), true);
  assert.equal(isConversationOnlyQuestion('请帮我拟定下周发布计划'), false);
  assert.equal(isConversationOnlyQuestion('胶带效果的核心实现原理是什么'), false);
  assert.equal(shouldRetrieveKnowledge({ question: '你好' }), false);
  assert.equal(isConversationOnlyQuestion('帮我支付'), true);
  assert.equal(shouldRetrieveKnowledge({ question: '帮我支付' }), false);
  assert.equal(isConversationOnlyQuestion('你会写代码吗'), true);
  assert.equal(isConversationOnlyQuestion('能导出飞书吗'), true);
  assert.equal(isConversationOnlyQuestion('怎么导出到飞书'), true);
  assert.equal(isConversationOnlyQuestion('如何写成笔记'), true);
  assert.equal(shouldRetrieveKnowledge({ question: '怎么导出到飞书' }), false);
  assert.equal(isConversationOnlyQuestion('把这个发到飞书'), false);
  assert.equal(isConversationOnlyQuestion('怎么把这个发到飞书'), false);
  assert.equal(isHowToWriteQuestion('怎么导出到飞书'), true);
  assert.equal(isHowToWriteQuestion('怎么把这个发到飞书'), false);
  assert.equal(isTransformableAssistantAnswer('陆星淇知识库助手是一款知识库工具。'), true);
  assert.equal(isTransformableAssistantAnswer('当前没有待确认的写入提案。直接说要写什么，我才会出确认面板。'), false);
  assert.equal(isTransformableAssistantAnswer('你好。我是 FlowMind，可以帮你查知识库、读文档、写笔记或草稿、创建飞书文档、查图谱。直接说要做什么就行。'), false);
  assert.equal(isConversationOnlyQuestion('知识库里的支付流程是什么'), false);
  assert.equal(shouldRetrieveKnowledge({ question: '请帮我拟定下周发布计划' }), true);
  assert.equal(isArtifactWorkQuestion('写一个 hello 函数'), true);
  assert.equal(shouldRetrieveKnowledge({ question: '写一个 hello 函数' }), false);
  assert.equal(shouldRetrieveKnowledge({ question: '根据文档写一个脚本' }), true);
  assert.equal(shouldRetrieveKnowledge({ question: '胶带效果的核心实现原理是什么' }), true);
  assert.match(conversationFastReply('你好'), /你好/);
  assert.match(conversationFastReply('帮我支付'), /不能收款/);
  assert.equal(isFollowUpQuestion('详细说说'), true);
  assert.equal(isFollowUpQuestion('把这个总结写成笔记'), true);
  assert.equal(isFollowUpQuestion('把这个发到飞书'), true);
  assert.equal(isFollowUpQuestion('把刚才的回答发到飞书'), true);
  assert.equal(isFollowUpQuestion('改一下'), true);
  assert.equal(isFollowUpQuestion('翻译一下'), true);
  assert.equal(isFollowUpQuestion('精简一下'), true);
  assert.equal(isFollowUpQuestion('你好'), false);
  assert.equal(isAnswerTransformQuestion('翻译一下'), true);
  assert.equal(isAnswerTransformQuestion('精简一下'), true);
  assert.equal(isAnswerTransformQuestion('译成英文'), true);
  assert.equal(isAnswerTransformQuestion('再短一点'), true);
  assert.equal(isAnswerTransformQuestion('改成中文'), true);
  assert.equal(isAnswerTransformQuestion('把这个发到飞书'), false);
  assert.equal(isConfirmationApproval('确认'), true);
  assert.equal(isConfirmationApproval('好的'), true);
  assert.equal(isSoftConfirmationApproval('嗯'), true);
  assert.equal(isSoftConfirmationApproval('对'), true);
  assert.equal(isConfirmationRejection('取消'), true);
  assert.equal(isConfirmationRejection('不要了'), true);
  assert.equal(isConfirmationReply('确认写入'), true);
  assert.equal(isOpenLastWrittenQuestion('打开刚才那篇'), true);
  assert.equal(isOpenLastWrittenQuestion('看看刚才写的笔记'), true);
  assert.equal(isOpenLastWrittenQuestion('打开刚才的草稿'), true);
  assert.equal(isOpenLastWrittenQuestion('改一下'), false);
  assert.equal(shouldRetrieveKnowledge({ question: '翻译一下' }), false);
  assert.equal(shouldRetrieveKnowledge({ question: '译成英文' }), false);
  assert.equal(shouldRetrieveKnowledge({ question: '确认' }), false);
  assert.equal(shouldRetrieveKnowledge({ question: '再记一点' }), false);
  assert.equal(shouldRetrieveKnowledge({ question: '下次记得放葱花' }), false);
  assert.equal(shouldRetrieveKnowledge({ question: '下次记得审批闸门是谁' }), true);
  assert.equal(isConversationOnlyQuestion('嗯'), true);
  assert.equal(isConversationOnlyQuestion('对'), true);
  assert.match(conversationFastReply('你会写代码吗'), /草稿/);
  assert.match(conversationFastReply('怎么导出到飞书'), /确认/);
  assert.match(conversationFastReply('谢谢'), /不客气/);
  assert.match(conversationFastReply('好的'), /下一句/);
  assert.equal(isOrphanFollowUp('详细说说', { messages: [] }), true);
  assert.equal(isOrphanFollowUp('详细说说', { messages: [{ role: 'user', content: '对比 Hermes Agent 和 Agent Loop' }] }), false);
  assert.equal(
    expandRetrievalQuery('详细说说', { messages: [{ role: 'user', content: '对比 Hermes Agent 和 Agent Loop' }] }),
    '对比 Hermes Agent 和 Agent Loop 详细说说'
  );
  assert.equal(
    expandRetrievalQuery('把这个总结写成笔记', { messages: [{ role: 'user', content: '对比 Hermes Agent 和 Agent Loop' }] }),
    '对比 Hermes Agent 和 Agent Loop 把这个总结写成笔记'
  );
  assert.match(
    expandRetrievalQuery('这篇在讲什么', { messages: [] }, ['发布计划', '风险清单']),
    /发布计划/
  );
});

test('Chinese comparison questions keep both named sources in retrieval',
  () => {
    const phrases = distinctiveQueryPhrases('对比发布计划和风险清单');
    assert.ok(phrases.some(phrase => phrase.includes('发布计划')));
    assert.ok(phrases.some(phrase => phrase.includes('风险清单')));
    const ranked = searchDocuments([
      { id: 'plan', title: '发布计划：上线清单', content: '上线前要过安全审批。' },
      { id: 'risk', title: '风险清单：回滚条件', content: '失败就按灰度回滚。' },
      { id: 'note', title: '知识笔记：对比发布计划和风险清单', content: '两边都在讲上线。', source: 'local-note', type: 'note' }
    ], '对比发布计划和风险清单', { limit: 3 });
    const ids = ranked.map(entry => entry.document.id);
    assert.ok(ids.includes('plan'));
    assert.ok(ids.includes('risk'));
    assert.ok(ids.indexOf('plan') < 2 || ids.indexOf('risk') < 2);
  });

test('softened Chinese questions can still hit a title when filler words differ', () => {
  assert.match(softenRetrievalQuery('上线前谁负责审批？'), /审批/);
  const ranked = relaxedTitleSearch([
    { id: 'plan', title: '发布计划：安全审批清单', content: 'Alice 负责周五前完成审批。' },
    { id: 'menu', title: '食堂周菜单', content: '周一西红柿炒鸡蛋。' }
  ], '上线前谁负责审批？', { limit: 2 });
  assert.equal(ranked[0].document.id, 'plan');
  assert.equal(
    relaxedTitleSearch([{ id: 'plan', title: 'Release plan', content: 'Alice owns the source anchor.' }], 'xyzzy-unobserved-anchor', { limit: 2 }).length,
    0
  );
});

test('workplace paraphrases expand into title terms without a vector index', () => {
  assert.match(expandQueryAliases('闸门谁拍板'), /审批/);
  assert.match(expandQueryAliases('谁点头放行'), /审批/);
  assert.match(expandQueryAliases('发车门槛'), /发布/);
  const ranked = searchDocuments([
    { id: 'plan', title: '发布计划：安全审批清单', content: 'Alice 负责周五前完成审批。' },
    { id: 'menu', title: '食堂周菜单', content: '周一西红柿炒鸡蛋。' }
  ], '闸门谁拍板', { limit: 2 });
  assert.equal(ranked[0].document.id, 'plan');
});

test('explicit document scope or attachments still retrieve even for greetings', () => {
  assert.equal(shouldRetrieveKnowledge({ question: '你好', requestedIds: new Set(['doc-1']) }), true);
  assert.equal(shouldRetrieveKnowledge({ question: '你好', requestedIds: ['doc-1'] }), true);
  assert.equal(shouldRetrieveKnowledge({ question: '你好', attachmentCount: 1 }), true);
});

test('reader ask lock ignores extra document ids and never expands to the library', () => {
  const lock = resolveReaderAskLock({
    surface: 'reader',
    readerDocumentId: 'doc-current',
    documentIds: ['doc-current', 'doc-outside']
  });
  assert.deepEqual(lock.documentIds, ['doc-current']);
  assert.equal(lock.includeKnowledgeBase, false);
  assert.equal(shouldIncludeKnowledgeBase({ includeKnowledgeBase: true, readerLocked: true, scopeRequested: true }), false);
  assert.equal(shouldIncludeKnowledgeBase({ includeKnowledgeBase: false, attachmentCount: 0, scopeRequested: true }), false);
  assert.equal(shouldIncludeKnowledgeBase({ includeKnowledgeBase: false, attachmentCount: 1, scopeRequested: false }), false);
  assert.equal(shouldIncludeKnowledgeBase({ attachmentCount: 1 }), false);
  assert.equal(shouldIncludeKnowledgeBase({ includeKnowledgeBase: true, attachmentCount: 1 }), true);
  assert.equal(shouldIncludeKnowledgeBase({ includeKnowledgeBase: false, attachmentCount: 0, scopeRequested: false }), true);
  const noteLock = resolveReaderAskLock({ surface: 'note-assistant', readerDocumentId: 'note-1', documentIds: ['doc-1', 'note-1'] });
  assert.deepEqual(noteLock.documentIds, ['note-1']);
  assert.equal(noteLock.surface, 'note-assistant');
});

test('fast-path questions skip knowledge scan unless scope or attachments are present', () => {
  assert.equal(agentRunNeedsKnowledgeScan({ question: '你好' }), false);
  assert.equal(agentRunNeedsKnowledgeScan({ question: '确认' }), false);
  assert.equal(agentRunNeedsKnowledgeScan({ question: '翻译一下' }), false);
  assert.equal(agentRunNeedsKnowledgeScan({ question: '本周发布有哪些风险？' }), true);
  assert.equal(agentRunNeedsKnowledgeScan({ question: '你好', documentIds: ['doc-1'] }), true);
  assert.equal(AGENT_QUESTION_MAX_CHARS, 32 * 1024);
});

test('empty retrieval forbids factual model answers and exposes uncovered claims', () => {
  const decision = emptyRetrievalDecision({ question: '本周发布有哪些风险？', matchCount: 0, retrieved: true });
  assert.equal(decision.allowModel, false);
  assert.equal(decision.mode, 'knowledge');
  assert.equal(decision.reason, 'empty_retrieval');
  assert.equal(decision.answer, EMPTY_RETRIEVAL_ANSWER);
  assert.equal(decision.citationIntegrity.status, 'empty');
  assert.deepEqual(decision.relations.citationCoverage.uncoveredClaims, ['本周发布有哪些风险？']);
  assert.equal(decision.relations.citationCoverage.score, 0);
});

test('conversation-only and evidenced retrieval still allow the model', () => {
  assert.equal(emptyRetrievalDecision({ question: '你好', matchCount: 0, retrieved: false }).allowModel, true);
  assert.equal(emptyRetrievalDecision({ question: '本周发布有哪些风险？', matchCount: 2, retrieved: true }).allowModel, true);
  const relations = emptyRetrievalRelations('本周发布有哪些风险？');
  assert.equal(relations.citationIntegrity.reason, 'empty_retrieval');
  assert.ok(relations.followUpSuggestions.length >= 1);
});

test('empty-evidence model prompt no longer invites free-form planning', async () => {
  const { buildChatSystemPrompt } = await import('../server/dialogue-prompts.mjs');
  const prompt = buildChatSystemPrompt({ hasEvidence: false });
  assert.match(prompt, /当前没有检索到可引用的知识库证据/);
  assert.match(prompt, /不要把库外常识写成知识库里的事实/);
  assert.doesNotMatch(prompt, /解释概念、整理计划/);
  assert.doesNotMatch(prompt, /只能根据给出的知识库证据/);
});
