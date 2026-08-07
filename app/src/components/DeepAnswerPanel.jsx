import React from 'react';
import {
  ArrowUpRight,
  BarChart3,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Clock3,
  FilePenLine,
  GitCompareArrows,
  Lightbulb,
  ListChecks,
  Network,
  NotebookPen,
  Sparkles,
  Tags,
  Target,
  WandSparkles
} from 'lucide-react';
import './DeepAnswerPanel.css';

function asArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (value == null || value === '') return [];
  return [value];
}

function displayText(value, fallback = '') {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return value?.text || value?.label || value?.name || value?.title || value?.summary || value?.explanation || value?.description || value?.relationReason || value?.content || fallback;
}

function clampScore(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(0, Math.min(100, number <= 1 ? number * 100 : number));
}

function coverageDetails(message) {
  const coverage = message?.citationCoverage ?? message?.coverage ?? message?.evidenceCoverage;
  if (coverage && typeof coverage === 'object') {
    const covered = Number(coverage.covered ?? coverage.cited ?? 0);
    const total = Number(coverage.total ?? coverage.claims ?? 0);
    const explicit = clampScore(coverage.percent ?? coverage.ratio ?? coverage.score);
    const percent = explicit ?? (total > 0 ? Math.round((covered / total) * 100) : 0);
    return {
      percent,
      detail: coverage.label || (total > 0 ? `${covered}/${total} 个关键结论有引用` : `${Math.round(percent)}% 已覆盖`)
    };
  }
  const percent = clampScore(coverage) ?? 0;
  return { percent, detail: `${Math.round(percent)}% 已覆盖` };
}

function normalizePlanStep(step, index) {
  if (typeof step === 'string') return { id: `step-${index}`, text: step, status: 'complete' };
  return {
    id: step?.id || `step-${index}`,
    text: displayText(step, `步骤 ${index + 1}`),
    status: step?.status || (step?.done ? 'complete' : 'pending')
  };
}

function normalizeDocument(document, index) {
  const score = clampScore(document?.score ?? document?.relevance ?? document?.similarity);
  return {
    ...document,
    id: document?.id || document?.documentId || `document-${index}`,
    title: displayText(document, `相关文档 ${index + 1}`),
    reason: document?.relationReason || document?.reason || document?.relation || document?.summary || '与当前问题存在可复用的知识关联',
    score
  };
}

function timelineLabel(item) {
  if (typeof item === 'string') return { date: '', text: item };
  return {
    date: item?.date || item?.time || item?.period || '',
    text: displayText(item, item?.event || item?.description || '')
  };
}

function SectionTitle({ icon: Icon, title, meta }) {
  return <div className="deep-answer-section-title">
    <span className="deep-answer-section-icon" aria-hidden="true"><Icon size={15}/></span>
    <h3>{title}</h3>
    {meta ? <span className="deep-answer-section-meta">{meta}</span> : null}
  </div>;
}

export function DeepAnswerPanel({ message = {}, busy = false, onFollowUp, onOpenDocument, onCreateArtifact }) {
  const intent = message.intent || message.analysis?.intent || message.intentLabel;
  const rewrittenQuestion = message.rewrittenQuestion || message.rewrite || message.analysis?.rewrittenQuestion || message.question;
  const planSource = message.plan?.steps || message.plan || message.steps || message.analysis?.plan?.steps || message.analysis?.plan;
  const plan = asArray(planSource).map(normalizePlanStep);
  const coverage = coverageDetails(message);
  const topics = asArray(message.topics || message.knowledge?.topics);
  const entities = asArray(message.entities || message.knowledge?.entities);
  const relatedDocuments = asArray(message.relatedDocuments || message.documents || message.knowledge?.relatedDocuments).map(normalizeDocument);
  const knowledgeMap = message.knowledgeMap || message.knowledge?.map || {};
  const mapNodes = asArray(knowledgeMap.nodes);
  const bidirectionalLinks = asArray(knowledgeMap.bidirectionalLinks || knowledgeMap.links);
  const consensus = asArray(message.consensus || message.synthesis?.consensus);
  const conflicts = asArray(message.conflicts || message.synthesis?.conflicts);
  const timeline = asArray(message.timeline || message.synthesis?.timeline).map(timelineLabel);
  const followUps = asArray(message.followUps || message.followUpSuggestions || message.suggestions);
  const isBusy = Boolean(busy);
  const busyAction = typeof busy === 'string' ? busy : '';
  const showProcessDetails = message.showProcessDetails === true;
  const hasSynthesis = consensus.length > 0 || conflicts.length > 0 || timeline.length > 0;

  function createArtifact(type) {
    onCreateArtifact?.(type, message);
  }

  return <section className="deep-answer-panel" aria-label="深度回答分析" aria-busy={isBusy}>
    <header className="deep-answer-header">
      <div className="deep-answer-heading">
        <span className="deep-answer-heading-icon" aria-hidden="true"><Sparkles size={18}/></span>
        <div>
          <h2>回答依据</h2>
          <p>只保留可核验的来源、真实关联和可继续执行的动作</p>
        </div>
      </div>
      <div className="deep-answer-artifacts" role="group" aria-label="将回答转为工作产物">
        <button type="button" disabled={isBusy} aria-label="将回答转为笔记" onClick={() => createArtifact('note')}>
          <NotebookPen size={15}/><span>转笔记</span>
        </button>
        <button type="button" disabled={isBusy} aria-label="将回答转为任务" onClick={() => createArtifact('task')}>
          <ListChecks size={15}/><span>转任务</span>
        </button>
        <button type="button" disabled={isBusy} aria-label="将回答转为写作草稿" onClick={() => createArtifact('writing')}>
          <FilePenLine size={15}/><span>写作草稿</span>
        </button>
        <button type="button" disabled={isBusy} aria-label={'\u751f\u6210\u8bc1\u636e\u56fe\u8868'} onClick={() => createArtifact('chart')}>
          <BarChart3 size={15}/><span>{'\u751f\u6210\u56fe\u8868'}</span>
        </button>
      </div>
    </header>

    {message.chartArtifact?.chartSpec ? <section className="deep-answer-block deep-answer-chart" aria-label={'\u8bc1\u636e\u56fe\u8868'}>
      <SectionTitle icon={BarChart3} title={message.chartArtifact.chartSpec.title || '\u8bc1\u636e\u56fe\u8868'} meta={message.chartArtifact.chartSpec.unit || '\u6765\u6e90\u8bc1\u636e'}/>
      <div className="deep-answer-chart-bars">{(message.chartArtifact.chartSpec.labels || []).map((label, index) => {
        const value = Number(message.chartArtifact.chartSpec.values?.[index] || 0);
        return <div className="deep-answer-chart-row" key={label + index}><div className="deep-answer-chart-label" title={label}>{label}</div><div className="deep-answer-chart-track"><span style={{ width: Math.max(4, Math.min(100, value)) + '%' }}/></div><b>{value}</b></div>;
      })}</div>
      <div className="deep-answer-chart-sources"><span>{'\u751f\u6210\u56fe\u8868'}</span>{(message.chartArtifact.sourceRefs || message.chartArtifact.chartSpec.sourceRefs || []).slice(0, 8).map((source, index) => <button type="button" key={(source.documentId || 'source') + index} onClick={() => onOpenDocument?.(source, message)}><span>[{index + 1}]</span>{source.title || source.documentId || '\u6765\u6e90\u6587\u6863'}{source.anchor ? <small>{source.anchor}</small> : null}</button>)}</div>
    </section> : null}

    {showProcessDetails ? <div className="deep-answer-overview">
      <article className="deep-answer-question-card">
        <SectionTitle icon={Target} title="问题理解"/>
        <div className="deep-answer-intent-row">
          <span>识别意图</span>
          <strong>{displayText(intent, '综合知识问答')}</strong>
          {intent?.confidence != null ? <small>{Math.round((clampScore(intent.confidence) ?? 0))}%</small> : null}
        </div>
        <div className="deep-answer-rewrite">
          <span><WandSparkles size={14}/>改写后的问题</span>
          <p>{displayText(rewrittenQuestion, '正在整理更适合检索与回答的问题…')}</p>
        </div>
      </article>

      <article className="deep-answer-coverage-card">
        <SectionTitle icon={BookOpen} title="引用覆盖率" meta={coverage.detail}/>
        <div
          className="deep-answer-progress"
          role="progressbar"
          aria-label="引用覆盖率"
          aria-valuemin="0"
          aria-valuemax="100"
          aria-valuenow={Math.round(coverage.percent)}
        >
          <span style={{ width: `${coverage.percent}%` }}/>
        </div>
        <div className="deep-answer-coverage-summary">
          <strong>{Math.round(coverage.percent)}%</strong>
          <span>{coverage.percent >= 80 ? '证据覆盖充分' : coverage.percent >= 50 ? '建议补充部分引用' : '需要补充更多证据'}</span>
        </div>
      </article>
    </div> : null}

    {showProcessDetails && plan.length > 0 ? <section className="deep-answer-block deep-answer-plan">
      <SectionTitle icon={ListChecks} title="回答计划" meta={`${plan.length} 个步骤`}/>
      <ol>
        {plan.map((step, index) => <li key={step.id} data-status={step.status}>
          <span className="deep-answer-step-state" aria-hidden="true">
            {step.status === 'complete' || step.status === 'done' ? <CheckCircle2 size={16}/> : <span>{index + 1}</span>}
          </span>
          <span>{step.text}</span>
        </li>)}
      </ol>
    </section> : null}

    {(topics.length > 0 || entities.length > 0) ? <section className="deep-answer-block">
      <SectionTitle icon={Tags} title="知识线索"/>
      <div className="deep-answer-taxonomy">
        {topics.length > 0 ? <div><span>主题</span><ul aria-label="相关主题">{topics.map((topic, index) => <li key={`topic-${index}`}>{displayText(topic)}</li>)}</ul></div> : null}
        {entities.length > 0 ? <div><span>实体</span><ul aria-label="相关实体">{entities.map((entity, index) => <li key={`entity-${index}`}>{displayText(entity)}</li>)}</ul></div> : null}
      </div>
    </section> : null}

    {relatedDocuments.length > 0 ? <section className="deep-answer-block deep-answer-documents">
      <SectionTitle icon={Network} title="相关文档" meta={`${relatedDocuments.length} 篇`}/>
      <div className="deep-answer-document-grid">
        {relatedDocuments.map(document => <article key={document.id}>
          <button
            type="button"
            className="deep-answer-document-card"
            disabled={isBusy}
            aria-label={`打开相关文档：${document.title}`}
            onClick={() => onOpenDocument?.(document, message)}
          >
            <span className="deep-answer-document-topline">
              <strong>{document.title}</strong>
              {document.score != null ? <span className="deep-answer-score">{Math.round(document.score)} 分</span> : null}
            </span>
            <span className="deep-answer-document-reason">{document.reason}</span>
            <span className="deep-answer-document-open">查看来源 <ArrowUpRight size={13}/></span>
          </button>
        </article>)}
      </div>
    </section> : null}

    {bidirectionalLinks.length > 0 ? <section className="deep-answer-block deep-answer-map-block">
      <SectionTitle icon={Network} title="知识地图" meta={`${mapNodes.length} 个节点 · ${bidirectionalLinks.length} 条双向关联`}/>
      <div className="deep-answer-map-flow">
        <div className="deep-answer-map-hub"><Sparkles size={14}/><span>{displayText(mapNodes.find(node => node.type === 'question'), rewrittenQuestion)}</span></div>
        <div className="deep-answer-map-lanes">
          <div><span>主题 / 实体</span><div>{mapNodes.filter(node => node.type === 'topic' || node.type === 'entity').slice(0, 10).map(node => <em key={node.id}>{displayText(node)}</em>)}</div></div>
          <div><span>关联文档</span><div>{mapNodes.filter(node => node.type === 'document').slice(0, 8).map(node => <button type="button" key={node.id} onClick={() => onOpenDocument?.(node, message)} disabled={isBusy}>{displayText(node)}<ArrowUpRight size={12}/></button>)}</div></div>
        </div>
        {bidirectionalLinks.length > 0 ? <div className="deep-answer-bidirectional"><strong>双向关联</strong>{bidirectionalLinks.slice(0, 8).map((link, index) => <div key={`link-${index}`}><span>{link.fromTitle || link.fromDocumentId}</span><GitCompareArrows size={13}/><span>{link.toTitle || link.toDocumentId}</span><small>{link.reason || '共享知识线索'}</small></div>)}</div> : <p className="deep-answer-empty">暂未发现足够强的文档间双向关联。</p>}
      </div>
    </section> : null}

    {hasSynthesis ? <div className="deep-answer-insight-grid">
      {consensus.length > 0 ? <section className="deep-answer-block deep-answer-insight consensus">
        <SectionTitle icon={CheckCircle2} title="共识"/>
        <ul>{consensus.map((item, index) => <li key={`consensus-${index}`}><CircleDot size={12}/><span>{displayText(item)}</span></li>)}</ul>
      </section> : null}
      {conflicts.length > 0 ? <section className="deep-answer-block deep-answer-insight conflicts">
        <SectionTitle icon={GitCompareArrows} title="冲突观点"/>
        <ul>{conflicts.map((item, index) => <li key={`conflict-${index}`}><GitCompareArrows size={12}/><span>{displayText(item)}</span></li>)}</ul>
      </section> : null}
      {timeline.length > 0 ? <section className="deep-answer-block deep-answer-insight timeline">
        <SectionTitle icon={Clock3} title="时间线"/>
        <ol>{timeline.map((item, index) => <li key={`timeline-${index}`}>
          <span className="deep-answer-timeline-dot" aria-hidden="true"/>
          <div>{item.date ? <time>{item.date}</time> : null}<span>{item.text}</span></div>
        </li>)}</ol>
      </section> : null}
    </div> : null}
    {followUps.length > 0 ? <section className="deep-answer-block deep-answer-follow-ups">
      <SectionTitle icon={Lightbulb} title="继续追问" meta="选择一个方向深入"/>
      <div>
        {followUps.map((suggestion, index) => {
          const text = displayText(suggestion);
          return <button
            type="button"
            key={`follow-up-${index}`}
            disabled={isBusy}
            aria-label={`继续追问：${text}`}
            onClick={() => onFollowUp?.(text, message)}
          >
            <span>{text}</span><ChevronRight size={15}/>
          </button>;
        })}
      </div>
    </section> : null}

    {isBusy ? <div className="deep-answer-busy" role="status" aria-live="polite">
      <span className="deep-answer-spinner" aria-hidden="true"/>
      {busyAction ? `正在${busyAction}…` : '正在整理深度回答…'}
    </div> : null}
  </section>;
}
