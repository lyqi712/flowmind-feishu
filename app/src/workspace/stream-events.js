export function isBatchableStreamEvent(event) {
  return event?.type === 'delta' || event?.type === 'model-delta';
}

export function isStickToBottom(scroller, threshold = 96) {
  if (!scroller || typeof scroller.scrollHeight !== 'number') return true;
  return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= threshold;
}

export function scrollTranscriptToEnd(endNode, { streaming = false, force = false } = {}) {
  if (!endNode) return false;
  const scroller = endNode.parentElement;
  if (!force && scroller && !isStickToBottom(scroller)) return false;
  endNode.scrollIntoView({ behavior: streaming ? 'auto' : 'smooth', block: 'end' });
  return true;
}

export function coalesceStreamEvents(events = []) {
  const coalesced = [];
  for (const event of Array.isArray(events) ? events : []) {
    if (!event || typeof event !== 'object') continue;
    const previous = coalesced[coalesced.length - 1];
    if (isBatchableStreamEvent(event) && previous && isBatchableStreamEvent(previous) && previous.type === event.type) {
      coalesced[coalesced.length - 1] = {
        ...previous,
        ...event,
        delta: `${previous.delta || ''}${event.delta || ''}`
      };
      continue;
    }
    coalesced.push(event);
  }
  return coalesced;
}

export function createStreamEventBatcher({
  onFlush,
  delayMs = 32,
  schedule = (fn, ms) => setTimeout(fn, ms),
  cancel = id => clearTimeout(id)
} = {}) {
  if (typeof onFlush !== 'function') throw new TypeError('onFlush is required');
  let queued = [];
  let timer = null;

  const flush = () => {
    if (timer != null) {
      cancel(timer);
      timer = null;
    }
    if (!queued.length) return;
    const events = queued;
    queued = [];
    onFlush(coalesceStreamEvents(events));
  };

  return {
    push(event) {
      if (!event || typeof event !== 'object') return;
      queued.push(event);
      if (isBatchableStreamEvent(event)) {
        if (timer == null) timer = schedule(flush, Math.max(0, Number(delayMs) || 0));
        return;
      }
      flush();
    },
    flush
  };
}

export function applyAssistantStreamEvent(message, event, extras = {}) {
  if (!message || !event) return message;
  const agent = { ...(message.agent || {}), ...(extras.mode ? { mode: extras.mode } : {}) };
  if (event.type === 'start') {
    const startStatus = typeof extras.startStatus === 'function'
      ? extras.startStatus(event)
      : (event.fastReply ? '' : event.executionMode === 'research' ? '正在查证资料' : event.executionMode === 'change' ? '正在准备写入提案' : '我先查看知识库里的资料');
    return {
      ...message,
      status: startStatus,
      agentRunId: event.runId || message.agentRunId,
      conversationId: event.conversationId || message.conversationId,
      agent: {
        ...agent,
        runId: event.runId,
        plan: event.plan || [],
        scope: event.scope || null,
        executionMode: event.executionMode,
        tools: [],
        observations: []
      }
    };
  }
  if (event.type === 'status') return { ...message, status: event.detail || message.status, agent };
  if (event.type === 'delta' || event.type === 'model-delta') return { ...message, status: event.type === 'model-delta' ? '正在生成产物' : '', text: `${message.text || ''}${event.delta || ''}`, agent };
  if (event.type === 'tool') {
    return { ...message, agent: { ...agent, tools: [...(agent.tools || []), { tool: event.tool, status: 'running' }] } };
  }
  if (event.type === 'observation') {
    const mergeKnowledgeWork = extras.mergeKnowledgeWork;
    return {
      ...message,
      knowledgeWork: typeof mergeKnowledgeWork === 'function' ? mergeKnowledgeWork(message.knowledgeWork, event) : message.knowledgeWork,
      agent: {
        ...agent,
        observations: [...(agent.observations || []), event.observation || event],
        tools: (agent.tools || []).map(tool => tool.tool === event.tool ? { ...tool, status: event.status || 'completed' } : tool)
      }
    };
  }
  if (event.type === 'confirmation-required') {
    return { ...message, status: '等待确认写入', agent: { ...agent, confirmation: event.confirmation, diff: event.diff, sourceRefs: event.sourceRefs || [] } };
  }
  if (event.type === 'confirmation-decision') {
    return { ...message, status: event.approved ? '正在确认写入' : '正在取消写入', agent };
  }
  if (event.type === 'confirmation-applied') {
    const confirmation = event.confirmation || agent.confirmation;
    const artifact = event.artifact || agent.writtenArtifact || null;
    return {
      ...message,
      conversationId: event.conversationId || message.conversationId,
      agent: { ...agent, confirmation, writtenArtifact: artifact, status: confirmation?.status || agent.status }
    };
  }
  if (event.type === 'error') {
    return { ...message, status: '', error: event.error?.message || extras.errorFallback || '提问失败', done: true, agent };
  }
  if (event.type === 'done') {
    const sanitize = typeof extras.sanitizeAnswer === 'function' ? extras.sanitizeAnswer : value => value;
    const answer = sanitize(event.result?.answer || event.answer || message.text);
    const citations = event.result?.sourceRefs || event.citations || message.citations || [];
    const relations = event.relations || event.result?.relations || message.relations || null;
    const citationIntegrity = event.result?.citationIntegrity || relations?.citationIntegrity || message.citationIntegrity || null;
    const artifact = event.result?.writtenArtifact || agent.writtenArtifact || null;
    const mergeKnowledgeWork = extras.mergeKnowledgeWork;
    return {
      ...message,
      status: '',
      text: answer,
      citations,
      relations,
      citationIntegrity,
      done: Boolean(event.result?.answer || event.answer || message.text),
      conversationId: event.conversationId || message.conversationId,
      knowledgeWork: typeof mergeKnowledgeWork === 'function'
        ? mergeKnowledgeWork(message.knowledgeWork, { work: { documents: citations } })
        : message.knowledgeWork,
      agent: { ...agent, writtenArtifact: artifact }
    };
  }
  return message;
}
