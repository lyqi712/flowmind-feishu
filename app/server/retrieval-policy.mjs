import { isPitfallAppendQuestion } from '../src/workspace/note-capture.js';

const CASUAL_QUESTION_PATTERN = /^(?:hi|hello|hey|你好|您好|嗨|哈喽|在吗|早上好|下午好|晚上好|谢谢|感谢|多谢|好的|好呀|好嘞|嗯|嗯嗯|对|对的|可以的|ok|okay|测试)(?:呀|啊|呢|喽|哦)?$/iu;
const GENERAL_ASSISTANT_QUESTION_PATTERN = /^(?:你是谁|你能做什么|你能帮我做什么|可以做什么|怎么用|如何使用你)$/u;
const CAPABILITY_QUESTION_PATTERN = /^(?:你)?(?:会|能|可以)(?:帮我)?(?:写(?:代码|文件|笔记|草稿)|导出(?:到)?飞书|创建飞书文档|发到飞书)(?:吗|么)?$/u;
const HOWTO_WRITE_QUESTION_PATTERN = /^(?:怎么|如何|怎样).{0,16}(?:导出到飞书|发到飞书|写成笔记|写代码|写文件|创建飞书文档|写笔记|写草稿)/u;
const CHECKOUT_ACTION_PATTERN = /^(?:帮我)?(?:支付|付款|收款|开通会员|续费|去结账)(?:一下|吧)?$|(?:你)?(?:能|可以)(?:帮我)?(?:支付|付款|收款|开通会员)/u;
const FOLLOW_UP_ONLY_PATTERN = /^(?:详细(?:说说|点|讲讲)?|展开(?:说说)?|再说说|继续|然后呢|还有呢|为什么|怎么说|这个呢|那个呢|它呢|具体呢|举个例子|那它|那这个|那份呢|呢|more|continue|why|explain(?:more)?)$/iu;
const ANSWER_TRANSFORM_PATTERN = /^(?:(?:请|帮我)?(?:把|将)?(?:这个|刚才|以上|上述|本次|前面的?)?(?:回答|答案|内容|这段)?)?(?:翻译(?:成[一-鿿A-Za-z]{1,12}|为[一-鿿A-Za-z]{1,12}|一下)?|译成[一-鿿A-Za-z]{1,12}|精简一下|缩一下|改短一点|再短一点|再短些|缩短一点|再简洁一点|总结一下|用英文(?:说|写|翻译)?|用中文(?:说|写|翻译)?|改成(?:英文|中文|英语)|translate(?:this|it)?|summarize(?:this|it)?)$/u;
const CONFIRMATION_SOFT_APPROVE_PATTERN = /^(?:好的|好|好呀|好嘞|可以|可以的|行|嗯|嗯嗯|对|对的|ok|okay)$/u;
const CONFIRMATION_APPROVE_PATTERN = /^(?:确认(?:写入|一下)?|写入吧|可以写入|就这样写|就按这个写|同意写入|批准|好的写入|写入|同意)$/u;
const CONFIRMATION_REJECT_PATTERN = /^(?:取消|拒绝|不要写|先别写|先不要|算了|算了吧|不用了|不要了|不用写了|别写了)$/u;
const OPEN_LAST_WRITTEN_PATTERN = /^(?:打开|看看|看一下)(?:一下)?(?:刚才|刚刚|上次)?(?:写的|写入的)?(?:那篇|这篇|那个|这个)?(?:的)?(?:笔记|草稿|文档|飞书文档)?$/u;

export const EMPTY_RETRIEVAL_ANSWER = '库里这会儿对不上这个问题。我先不编。你可以换个说法、点开一篇再问，或把范围扩一下。';

function normalizeQuestion(value) {
  return String(value || '').trim();
}

function scopeSize(requestedIds) {
  if (!requestedIds) return 0;
  if (typeof requestedIds.size === 'number') return requestedIds.size;
  if (Array.isArray(requestedIds)) return requestedIds.filter(Boolean).length;
  return 0;
}

export function isHowToWriteQuestion(value) {
  const normalized = compactQuestion(value);
  if (!normalized) return false;
  if (CAPABILITY_QUESTION_PATTERN.test(normalized)) return true;
  if (/(?:把|将)(?:这个|刚才|以上|上述|本次|前面|这段)/u.test(normalized)) return false;
  return HOWTO_WRITE_QUESTION_PATTERN.test(normalized);
}

export function isConversationOnlyQuestion(value) {
  const normalized = normalizeQuestion(value).toLocaleLowerCase().replace(/[「」"'`~～，。！？!?、,.\s]+/gu, '');
  if (!normalized) return false;
  if (CASUAL_QUESTION_PATTERN.test(normalized) || GENERAL_ASSISTANT_QUESTION_PATTERN.test(normalized)) return true;
  if (isHowToWriteQuestion(value)) return true;
  if (/(?:知识库|文档|资料|笔记)/u.test(normalized)) return false;
  return CHECKOUT_ACTION_PATTERN.test(normalized);
}

export function conversationFastReply(value) {
  const normalized = normalizeQuestion(value).toLocaleLowerCase().replace(/[「」"'`~～，。！？!?、,.\s]+/gu, '');
  if (CHECKOUT_ACTION_PATTERN.test(normalized) || /(?:支付|付款|收款|开通会员|续费)/u.test(normalized)) {
    return '这条对话里不能收款，也没有收银或开通会员的接口。会员和付款不在知识库对话里完成。如果要查库里的支付资料，直接说文档名或流程名。';
  }
  if (/^(?:谢谢|感谢|多谢)(?:你|啦|了|啊|呀)?$/u.test(normalized)) {
    return '不客气。要查知识库、读某篇，还是写笔记，直接说就行。';
  }
  if (/^(?:好的|好呀|好嘞|嗯|嗯嗯|对|对的|可以的|ok|okay|测试)$/iu.test(normalized)) {
    return '好。下一句直接说要查知识库什么、改什么，或写成笔记。';
  }
  if (GENERAL_ASSISTANT_QUESTION_PATTERN.test(normalized) || isHowToWriteQuestion(value)) {
    return '我是 FlowMind。查知识库、对照资料、看图谱都可以；写成笔记、草稿、任务或飞书文档要你确认后才落盘。写代码会做成草稿给你看，不会在这台电脑上执行。直接说要做什么就行。';
  }
  return '你好。我是 FlowMind，可以帮你查知识库、读文档、写笔记或草稿、创建飞书文档、查图谱。直接说要做什么就行。';
}

function compactQuestion(value) {
  return normalizeQuestion(value).toLocaleLowerCase().replace(/[「」"'`~～，。！？!?、,.\s]+/gu, '');
}

export function isTransformableAssistantAnswer(content, extras = {}) {
  const text = normalizeQuestion(content);
  if (!text) return false;
  const policy = extras.retrievalPolicy && typeof extras.retrievalPolicy === 'object' ? extras.retrievalPolicy : {};
  const reason = String(extras.reason || policy.reason || '').trim();
  const citationStatus = String(extras.citationStatus || extras.agent?.citationStatus || '').trim();
  if (extras.fastReply === true || policy.fastReply === true) return false;
  if (['conversation_only', 'confirmation_idle', 'confirmation_not_pending', 'transform_without_answer'].includes(reason)) return false;
  if (citationStatus === 'confirmation-decided' || citationStatus === 'confirmation-decision') return false;
  if (/当前没有待确认的写入提案|刚才那条写入提案已经不在待确认状态|上一句还没有可改写的回答/.test(text)) return false;
  if (/^你好[。.]我是 FlowMind|^我是 FlowMind|^不客气|^好。下一句直接说|这条对话里不能收款|库里这会儿对不上/.test(text)) return false;
  if (/^已取消这次写入|^已确认写入|^已写入(?:写作草稿|笔记|任务)|^已补进问题记录|^已记下问题记录/.test(text)) return false;
  return true;
}

export function isAnswerTransformQuestion(value) {
  const normalized = compactQuestion(value);
  if (!normalized || isConversationOnlyQuestion(value)) return false;
  if (/(?:写成|写进|发到|导出到)(?:笔记|草稿|任务|飞书)/u.test(normalized)) return false;
  return ANSWER_TRANSFORM_PATTERN.test(normalized);
}

export function isOpenLastWrittenQuestion(value) {
  const normalized = compactQuestion(value);
  if (!normalized) return false;
  if (/(?:写成|写进|发到|导出到|改一下|翻译|精简)/u.test(normalized)) return false;
  return OPEN_LAST_WRITTEN_PATTERN.test(normalized);
}

export function isSoftConfirmationApproval(value) {
  return CONFIRMATION_SOFT_APPROVE_PATTERN.test(compactQuestion(value));
}

export function isConfirmationApproval(value) {
  const normalized = compactQuestion(value);
  return CONFIRMATION_APPROVE_PATTERN.test(normalized) || CONFIRMATION_SOFT_APPROVE_PATTERN.test(normalized);
}

export function isHardConfirmationApproval(value) {
  return CONFIRMATION_APPROVE_PATTERN.test(compactQuestion(value));
}

export function isConfirmationRejection(value) {
  return CONFIRMATION_REJECT_PATTERN.test(compactQuestion(value));
}

export function isConfirmationReply(value) {
  return isConfirmationApproval(value) || isConfirmationRejection(value);
}

export function isFollowUpQuestion(value) {
  const normalized = compactQuestion(value);
  if (!normalized || isConversationOnlyQuestion(value)) return false;
  if (FOLLOW_UP_ONLY_PATTERN.test(normalized)) return true;
  if (isAnswerTransformQuestion(value)) return true;
  if (normalized.length <= 10 && /(?:这个|那个|它|他|她|这|那|呢|吗|怎么|为何|为啥|还有|然后|继续|详细|具体)/u.test(normalized) && !/[a-z0-9]/i.test(normalized)) return true;
  if (/(?:把|将)?(?:这个|刚才|以上|上述|本次|前面的?)(?:的)?(?:总结|对比|结论|回答|内容|答案)?(?:写成|记成|存成|做成|发到|导出到)(?:笔记|草稿|任务|飞书(?:文档)?)/u.test(normalized)) return true;
  return /^(?:改一下|润色一下|再改一版|修改一下|帮我改一下|把这个改一下|继续改|再润色)/u.test(normalized);
}

export function lastSubstantiveUserQuestion(handoff) {
  const messages = Array.isArray(handoff?.messages) ? handoff.messages : [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (String(message?.role || '').toLowerCase() !== 'user') continue;
    const content = normalizeQuestion(message?.content ?? message?.text);
    if (!content) continue;
    if (isConversationOnlyQuestion(content) || isFollowUpQuestion(content)) continue;
    return content;
  }
  return '';
}

export function expandRetrievalQuery(question, handoff, extraTitles = []) {
  const current = normalizeQuestion(question);
  const prior = lastSubstantiveUserQuestion(handoff);
  const extras = (Array.isArray(extraTitles) ? extraTitles : []).map(title => String(title || '').trim()).filter(Boolean).slice(0, 4).join(' ');
  if (!current) return [prior, extras].filter(Boolean).join(' ').trim();
  if (prior && prior !== current && isFollowUpQuestion(current)) return [prior, current, extras].filter(Boolean).join(' ').trim();
  return extras ? `${current} ${extras}`.trim() : current;
}

export function isOrphanFollowUp(question, handoff) {
  const normalized = compactQuestion(question);
  if (!normalized || lastSubstantiveUserQuestion(handoff)) return false;
  if (isConversationOnlyQuestion(question)) return false;
  return FOLLOW_UP_ONLY_PATTERN.test(normalized);
}

export const AGENT_QUESTION_MAX_CHARS = 32 * 1024;

export function shouldRetrieveKnowledge({ question, requestedIds, attachmentCount = 0 } = {}) {
  if (scopeSize(requestedIds) || Number(attachmentCount) > 0) return true;
  if (isConversationOnlyQuestion(question)) return false;
  if (isAnswerTransformQuestion(question)) return false;
  if (isOpenLastWrittenQuestion(question)) return false;
  if (isPitfallAppendQuestion(question)) return false;
  if (isConfirmationRejection(question) || isHardConfirmationApproval(question)) return false;
  if (isArtifactWorkQuestion(question)) return false;
  return Boolean(normalizeQuestion(question));
}

export function agentRunNeedsKnowledgeScan({ question, documentIds, selection, attachmentCount = 0 } = {}) {
  if (Number(attachmentCount) > 0) return true;
  if (scopeSize(documentIds) > 0) return true;
  if (selection && typeof selection === 'object' && (selection.documentId || selection.text || selection.quote)) return true;
  return shouldRetrieveKnowledge({ question, requestedIds: documentIds, attachmentCount });
}

function firstDocumentId(value) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    const found = value.map((item) => String(item || '').trim()).find(Boolean);
    return found || '';
  }
  return '';
}

export function resolveReaderAskLock({ surface, readerDocumentId, existingConversation, documentIds } = {}) {
  const lockedSurface = String(surface || existingConversation?.surface || '').trim();
  if (lockedSurface !== 'reader' && lockedSurface !== 'note-assistant') return null;
  const lockedId = String(readerDocumentId || existingConversation?.readerDocumentId || '').trim();
  const documentId = lockedId || firstDocumentId(documentIds);
  if (!documentId) return null;
  return {
    surface: lockedSurface,
    readerDocumentId: documentId,
    documentIds: [documentId],
    includeKnowledgeBase: false
  };
}

export function shouldIncludeKnowledgeBase({ includeKnowledgeBase, attachmentCount = 0, readerLocked = false, scopeRequested = false } = {}) {
  if (readerLocked) return false;
  if (Number(attachmentCount) > 0) return includeKnowledgeBase === true;
  if (includeKnowledgeBase === false) return !scopeRequested;
  return includeKnowledgeBase !== false;
}

export function emptyRetrievalRelations(question) {
  const claim = normalizeQuestion(question) || '当前问题';
  return {
    rewrittenQuestion: claim,
    intent: { type: 'lookup', label: '知识库检索', confidence: 1 },
    plan: { steps: ['检索知识库', '核验是否存在可引用证据', '没有证据时拒绝给出事实结论'] },
    topics: [],
    entities: [],
    relatedDocuments: [],
    knowledgeMap: { nodes: [], edges: [], bidirectionalLinks: [] },
    consensus: [],
    conflicts: [],
    timeline: [],
    citationCoverage: {
      score: 0,
      level: 'none',
      totalClaims: 1,
      supportedClaims: 0,
      unsupportedClaims: 1,
      citedDocuments: [],
      relevantDocuments: [],
      uncoveredClaims: [claim]
    },
    followUpSuggestions: ['补充相关文档后再问一次。', '缩小问题范围，改用资料里出现过的说法。'],
    citationIntegrity: { status: 'empty', invalidMarkers: [], validMarkers: [], reason: 'empty_retrieval' }
  };
}

export function isArtifactWorkQuestion(value) {
  const question = normalizeQuestion(value);
  if (!question) return false;
  if (/(?:知识库|资料|文档|笔记)/u.test(question)) return false;
  if (/(?:写(?:一段|个|一份)?(?:代码|脚本|函数|程序|组件|页面|文件)|帮我写代码|生成代码|implement|write (?:some )?code)/iu.test(question)) return true;
  if (/(?:写|生成|创建|编写)(?:一份|一个|篇)?\s*(?:readme|markdown)?\s*(?:文件|文档)|\.md\b|\.txt\b|\.py\b|\.js\b|\.ts\b|\.jsx\b|\.tsx\b/iu.test(question)) return true;
  return /(?:写|生成|实现|编写|create|write|implement|generate)/iu.test(question) && /(?:代码|脚本|函数|程序|组件|页面|文件|code|script|function|component|readme)/iu.test(question);
}

export function isKnowledgeFreeTaskQuestion(value) {
  const question = normalizeQuestion(value);
  if (!question) return false;
  if (/(?:知识库|资料|文档|笔记)(?:里|中|说|提到|根据)/u.test(question)) return false;
  if (isArtifactWorkQuestion(question)) return true;
  return /(?:拟定|起草|写个大纲|帮我想|出个方案|列个提纲|拆成步骤|写封邮件|写个演讲|整理会议纪要|写周报)/u.test(question);
}

export function emptyRetrievalDecision({ question, matchCount = 0, retrieved = true } = {}) {
  if (!retrieved) {
    return {
      allowModel: true,
      mode: 'conversation',
      reason: 'conversation_only',
      answer: '',
      relations: null,
      citationIntegrity: { status: 'ok', invalidMarkers: [], validMarkers: [], reason: 'conversation_only' }
    };
  }
  if (Number(matchCount) > 0) {
    return {
      allowModel: true,
      mode: 'knowledge',
      reason: 'has_evidence',
      answer: '',
      relations: null,
      citationIntegrity: { status: 'ok', invalidMarkers: [], validMarkers: [], reason: 'has_evidence' }
    };
  }
  if (isConversationOnlyQuestion(question) || isKnowledgeFreeTaskQuestion(question)) {
    return {
      allowModel: true,
      mode: 'conversation',
      reason: isConversationOnlyQuestion(question) ? 'conversation_only' : 'open_task',
      answer: '',
      relations: null,
      citationIntegrity: { status: 'ok', invalidMarkers: [], validMarkers: [], reason: isConversationOnlyQuestion(question) ? 'conversation_only' : 'open_task' }
    };
  }
  const relations = emptyRetrievalRelations(question);
  return {
    allowModel: false,
    mode: 'knowledge',
    reason: 'empty_retrieval',
    answer: EMPTY_RETRIEVAL_ANSWER,
    relations,
    citationIntegrity: relations.citationIntegrity
  };
}