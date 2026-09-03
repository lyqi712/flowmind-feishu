import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  BookOpenCheck,
  Check,
  ChevronRight,
  CircleAlert,
  Clock3,
  FileText,
  GitCompareArrows,
  Lightbulb,
  LoaderCircle,
  Network,
  RefreshCw,
  Search,
  ShieldCheck,
  Target,
  X
} from 'lucide-react';
import './EvidenceWorkbench.css';
import { EvidenceStatusBadge } from './EvidenceStatus.jsx';

const unique = values => [...new Set((Array.isArray(values) ? values : []).map(value => String(value || '').trim()).filter(Boolean))];
const text = value => String(value ?? '').trim();

async function parseResponse(response) {
  const raw = await response.text();
  let data = {};
  if (raw) {
    try { data = JSON.parse(raw); } catch { data = { message: raw }; }
  }
  if (!response.ok) {
    const error = new Error(data?.error?.message || data?.message || `HTTP ${response.status}`);
    error.code = data?.error?.code || 'EVIDENCE_REQUEST_FAILED';
    throw error;
  }
  return data;
}

async function streamAgent(response, onEvent) {
  if (!response.ok) throw Object.assign(new Error(`Agent 请求失败（HTTP ${response.status}）`), { code: 'AGENT_REQUEST_FAILED' });
  if (!response.body) throw Object.assign(new Error('Agent 未返回流式结果'), { code: 'AGENT_STREAM_EMPTY' });
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const consume = line => {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    onEvent(event);
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      lines.forEach(consume);
    }
    buffer += decoder.decode();
    consume(buffer);
  } finally {
    reader.releaseLock();
  }
}

function evidenceKey(item, index) {
  return item?.id || `${item?.documentId || 'evidence'}-${index}`;
}

function bucketItems(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function capabilityLabel(item) {
  if (item.effect === 'write') return '写入';
  if (item.effect === 'external') return '外部';
  return '读取';
}

function statusLabel(status) {
  return ({ planned: '已规划', running: '执行中', completed: '已完成', confirmed: '已完成', awaiting_confirmation: '待确认', rejected: '已拒绝', failed: '失败', cancelled: '已取消', stale: '已过期', expired: '已过期' })[status] || status || '待开始';
}

export function EvidenceWorkbench({ documents = [], initialDocumentIds = [], initialQuestion = '', onOpenDocument, onClose }) {
  const initialScope = useMemo(() => unique(initialDocumentIds), [initialDocumentIds]);
  const [question, setQuestion] = useState(text(initialQuestion));
  const [selectedIds, setSelectedIds] = useState(initialScope);
  const [sourceFilter, setSourceFilter] = useState('');
  const [capabilities, setCapabilities] = useState([]);
  const [run, setRun] = useState(null);
  const [phase, setPhase] = useState('idle');
  const [error, setError] = useState('');
  const [decisionOpen, setDecisionOpen] = useState(false);
  const [decisionTitle, setDecisionTitle] = useState('');
  const [decisionContent, setDecisionContent] = useState('');
  const [decisionBusy, setDecisionBusy] = useState(false);
  const [confirmation, setConfirmation] = useState(null);
  const researchAbortRef = useRef(null);
  const researchRequestRef = useRef(0);

  useEffect(() => {
    return () => {
      researchRequestRef.current += 1;
      researchAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    fetch('/api/agent/capabilities').then(parseResponse).then(data => setCapabilities(Array.isArray(data.capabilities) ? data.capabilities : [])).catch(() => setCapabilities([]));
  }, []);

  useEffect(() => {
    if (initialScope.length) setSelectedIds(initialScope);
  }, [initialScope]);

  const selectedDocuments = useMemo(() => documents.filter(document => selectedIds.includes(String(document.id))), [documents, selectedIds]);
  const visibleSourceDocuments = useMemo(() => {
    const needle = text(sourceFilter).toLocaleLowerCase();
    if (!needle) return documents;
    return documents.filter(document => [document.title, document.excerpt, document.source, document.contentType, ...(document.tags || [])].filter(Boolean).join(' ').toLocaleLowerCase().includes(needle));
  }, [documents, sourceFilter]);
  const evidence = Array.isArray(run?.evidence) ? run.evidence : [];
  const result = run?.result || null;
  const analysis = result?.analysis || { support: [], conflicts: [], gaps: [] };
  const availableCapabilities = capabilities.filter(item => item.available);
  const unavailableCapabilities = capabilities.filter(item => !item.available);

  function toggleDocument(id) {
    const value = String(id);
    setSelectedIds(current => current.includes(value) ? current.filter(item => item !== value) : [...current, value]);
  }

  function selectVisibleDocuments() {
    const visibleIds = visibleSourceDocuments.map(document => String(document.id));
    setSelectedIds(current => unique([...current, ...visibleIds]));
  }

  function clearSelectedDocuments() {
    setSelectedIds([]);
  }

  async function startResearch() {
    const normalizedQuestion = question.trim();
    if (!normalizedQuestion || !selectedIds.length || phase === 'running') return;
    const requestId = researchRequestRef.current + 1;
    researchRequestRef.current = requestId;
    researchAbortRef.current?.abort();
    const controller = new AbortController();
    researchAbortRef.current = controller;
    let streamFailed = false;
    setError('');
    setConfirmation(null);
    setDecisionOpen(false);
    setPhase('running');
    setRun({ status: 'planned', question: normalizedQuestion, scope: { documents: selectedDocuments.map(item => ({ id: item.id, title: item.title })) }, plan: [], evidence: [], tools: [] });
    try {
      const response = await fetch('/api/agent/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({ question: normalizedQuestion, mode: 'research', documentIds: selectedIds, maxSteps: 4 })
      });
      let local = null;
      await streamAgent(response, event => {
        if (requestId !== researchRequestRef.current || controller.signal.aborted) return;
        if (event.type === 'error') {
          streamFailed = true;
          setError(event.error?.message || 'Agent 执行失败');
          setPhase('error');
          return;
        }
        if (event.type === 'start') {
          local = { id: event.runId, status: 'running', question: normalizedQuestion, mode: event.mode, executionMode: event.executionMode, taskType: event.taskType, plan: event.plan || [], scope: event.scope || null, capabilities: event.capabilities || [], tools: [], evidence: [], audit: null };
          setRun(local);
          return;
        }
        if (event.type === 'status') {
          setRun(current => ({ ...(current || local || {}), phase: event.phase || event.status, status: event.status || 'running' }));
          return;
        }
        if (event.type === 'tool') {
          setRun(current => ({ ...(current || local || {}), tools: [...(current?.tools || local?.tools || []), { tool: event.tool, arguments: event.arguments, status: 'running' }] }));
          return;
        }
        if (event.type === 'observation') {
          const nextEvidence = [...(local?.evidence || []), ...(event.evidence || [])];
          local = { ...(local || {}), evidence: nextEvidence };
          setRun(current => ({ ...(current || {}), evidence: nextEvidence, tools: (current?.tools || []).map(tool => tool.tool === event.tool && tool.status === 'running' ? { ...tool, status: event.status } : tool) }));
          return;
        }
        if (event.type === 'done') {
          local = { ...(local || {}), id: event.runId || local?.id, status: event.result ? 'completed' : 'awaiting_confirmation', result: event.result || null, audit: event.audit || null };
          setRun(current => ({ ...(current || {}), ...local }));
          setPhase(event.result ? 'complete' : 'confirmation');
          return;
        }
        if (event.type === 'confirmation-required') {
          setConfirmation(event.confirmation || null);
          setRun(current => ({ ...(current || {}), status: 'awaiting_confirmation', phase: 'confirmation', confirmation: event.confirmation, evidence: current?.evidence || [] }));
          setPhase('confirmation');
        }
      });
      if (!streamFailed && requestId === researchRequestRef.current && !controller.signal.aborted) setPhase(current => current === 'running' ? 'complete' : current);
    } catch (requestError) {
      if (controller.signal.aborted || requestError?.name === 'AbortError') {
        if (requestId === researchRequestRef.current) {
          setPhase('cancelled');
          setRun(current => ({ ...(current || {}), status: 'cancelled', stoppedAt: new Date().toISOString() }));
        }
      } else if (requestId === researchRequestRef.current) {
        setError(requestError.message || '证据分析失败');
        setPhase('error');
        setRun(current => ({ ...(current || {}), status: 'failed' }));
      }
    } finally {
      if (researchAbortRef.current === controller) researchAbortRef.current = null;
    }
  }

  function stopResearch() {
    if (phase !== 'running' || !researchAbortRef.current) return;
    researchAbortRef.current.abort();
  }

  async function proposeDecision() {
    if (!run?.id || !result || decisionBusy) return;
    setDecisionBusy(true);
    setError('');
    try {
      const data = await fetch(`/api/agent/runs/${encodeURIComponent(run.id)}/decision-note`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: decisionTitle, content: decisionContent })
      }).then(parseResponse);
      setConfirmation(data.confirmation || null);
      setDecisionOpen(false);
      setPhase('confirmation');
      setRun(current => ({ ...current, status: 'awaiting_confirmation', confirmation: data.confirmation, decisionProposal: data }));
    } catch (requestError) {
      setError(requestError.message || '决策提案创建失败');
    } finally {
      setDecisionBusy(false);
    }
  }

  async function confirmDecision(approved) {
    if (!confirmation?.id || decisionBusy) return;
    setDecisionBusy(true);
    setError('');
    try {
      const data = await fetch(`/api/agent/confirmations/${encodeURIComponent(confirmation.id)}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ approved })
      }).then(parseResponse);
      setConfirmation(data.confirmation || { ...confirmation, status: approved ? 'confirmed' : 'rejected' });
      setRun(current => ({ ...current, status: approved ? 'completed' : 'cancelled', result: { ...(current?.result || {}), confirmation: approved ? 'confirmed' : 'rejected', writeResult: data.result || null } }));
      setPhase(approved ? 'complete' : 'cancelled');
    } catch (requestError) {
      const stale = ['AGENT_CONFIRMATION_STALE', 'AGENT_CONFIRMATION_EXPIRED', 'AGENT_PROPOSAL_HASH_MISMATCH', 'AGENT_EVIDENCE_NOT_OBSERVED'].includes(requestError?.code);
      setError(requestError.message || (stale ? '确认状态已失效，请重新分析' : '确认写入失败'));
      setConfirmation(current => current ? { ...current, status: stale ? 'stale' : 'failed' } : current);
      setPhase('error');
    } finally {
      setDecisionBusy(false);
    }
  }

  function openEvidence(item) {
    if (!item?.documentId) return;
    onOpenDocument?.({ ...item, id: item.documentId, documentId: item.documentId, title: item.title, anchor: item.anchor, excerpt: item.excerpt || item.quote || '' });
  }

  return <main className="evidence-workbench" aria-label="证据工作台" aria-busy={phase === 'running'}>
    <header className="evidence-workbench-header">
      <div className="evidence-workbench-title"><span className="evidence-workbench-mark"><BookOpenCheck size={19}/></span><div><span className="eyebrow">EVIDENCE WORKBENCH</span><h1>证据工作台</h1><p>问题 · 证据 · 判断 · 决策</p></div></div>
      <div className="evidence-workbench-actions"><span className={`evidence-run-status is-${phase}`} role="status" aria-live="polite" aria-atomic="true">{statusLabel(run?.status || (phase === 'idle' ? 'planned' : phase))}</span>{onClose && <button type="button" className="evidence-icon-button" aria-label="关闭证据工作台" title="关闭证据工作台" onClick={onClose}><X size={18}/></button>}</div>
    </header>

    <section className="evidence-query-band">
      <div className="evidence-query-main"><label htmlFor="evidence-question">研究问题</label><textarea id="evidence-question" name="evidence-question" value={question} onChange={event => setQuestion(event.target.value)} placeholder="例如：两份发布计划的共识、冲突和待确认项是什么？" disabled={phase === 'running'}/><div className="evidence-query-footer"><span><Target size={14}/>已选 {selectedIds.length} 篇资料</span>{phase === 'running' ? <button type="button" className="evidence-secondary-button" onClick={stopResearch}><X size={15}/>停止分析</button> : <button type="button" className="evidence-primary-button" disabled={!question.trim() || !selectedIds.length} onClick={startResearch}><Network size={15}/>开始分析</button>}</div></div>
      <div className="evidence-source-picker"><div className="evidence-section-heading"><span><FileText size={15}/>来源范围</span><small>服务端验证</small></div><div className="evidence-source-tools"><label><Search size={14}/><input value={sourceFilter} onChange={event => setSourceFilter(event.target.value)} placeholder="筛选来源" aria-label="筛选证据来源"/><span>{visibleSourceDocuments.length}</span></label><button type="button" onClick={selectVisibleDocuments} disabled={!visibleSourceDocuments.length || phase === 'running'}><Check size={13}/>加入筛选结果</button><button type="button" onClick={clearSelectedDocuments} disabled={!selectedIds.length || phase === 'running'}><X size={13}/>清空选择</button></div><div className="evidence-source-list">{visibleSourceDocuments.length ? visibleSourceDocuments.map(document => <label key={document.id} className={`evidence-source-row ${selectedIds.includes(String(document.id)) ? 'is-selected' : ''}`}><input type="checkbox" checked={selectedIds.includes(String(document.id))} onChange={() => toggleDocument(document.id)} disabled={phase === 'running'}/><span className="evidence-source-check"><Check size={12}/></span><span className="evidence-source-copy"><b>{document.title || '未命名文档'}</b><small>{document.contentType || '知识文档'}{document.updatedAt ? ` · ${new Date(document.updatedAt).toLocaleDateString('zh-CN')}` : ''}</small></span></label>) : <div className="evidence-empty-inline"><FileText size={18}/>暂无匹配资料</div>}</div></div>
    </section>

    {error && <div className="evidence-error" role="alert"><AlertCircle size={15}/><span>{error}</span><button type="button" className="evidence-error-retry" disabled={!question.trim() || !selectedIds.length || phase === 'running'} onClick={startResearch}><RefreshCw size={14}/>重试分析</button><button type="button" className="evidence-icon-button" aria-label="关闭错误" title="关闭错误" onClick={() => setError('')}><X size={14}/></button></div>}

    <section className="evidence-plan-strip">
      <div className="evidence-section-heading"><span><ShieldCheck size={15}/>执行契约</span><small>{run?.executionMode || '尚未启动'}</small></div>
      <div className="evidence-plan-steps">{(run?.plan || []).length ? run.plan.map((step, index) => <div key={`${step}-${index}`}><span>{index + 1}</span><b>{step}</b>{index < run.plan.length - 1 && <ChevronRight size={14}/>}</div>) : <span className="evidence-muted">开始分析后显示服务器计划</span>}</div>
      <details className="evidence-capabilities"><summary><span>能力快照</span><b>{availableCapabilities.length} 可用</b></summary><div className="evidence-capability-list">{(run?.capabilities || capabilities).map(item => <span key={item.name} className={item.available ? 'is-available' : 'is-unavailable'}><i>{item.available ? <Check size={11}/> : <X size={11}/>}</i>{item.name}<small>{capabilityLabel(item)}</small></span>)}</div>{unavailableCapabilities.length > 0 && <small className="evidence-capability-note">未配置能力不会被 Agent 自动调用</small>}</details>
    </section>

    <section className="evidence-ledger-section"><div className="evidence-section-heading"><span><BookOpenCheck size={15}/>证据账本</span><small>{evidence.length ? `${evidence.length} 条已观测` : '等待分析'}</small></div>{evidence.length ? <div className="evidence-ledger-list">{evidence.map((item, index) => <article className="evidence-ledger-row" key={evidenceKey(item, index)}><div className="evidence-ledger-index">{index + 1}</div><div className="evidence-ledger-copy"><div><b>{item.title || item.documentId}</b><EvidenceStatusBadge evidence={item} compact /><span className="evidence-id" title={item.id}>{item.id?.slice(0, 20)}</span></div><p>{item.excerpt || '已记录来源，但当前片段为空。'}</p><small>{item.anchor ? `锚点 ${item.anchor}` : '文档级来源'}{item.revision ? ` · revision ${item.revision}` : ''}{item.contentVersionId != null ? ` · version ${item.contentVersionId}` : ''}</small></div><button type="button" className="evidence-open-button" onClick={() => openEvidence(item)}><ChevronRight size={15}/>打开来源</button></article>)}</div> : <div className="evidence-empty-state"><BookOpenCheck size={28}/><b>{phase === 'running' ? '正在建立证据账本' : '尚未形成证据'}</b><span>选择资料并提交一个具体问题。</span></div>}</section>

    {result && <section className="evidence-analysis-section"><div className="evidence-section-heading"><span><GitCompareArrows size={15}/>判断结果</span><small className={`evidence-grounding is-${result.citationStatus || 'unknown'}`}>{result.citationStatus === 'grounded-observation' ? '已由观测证据支撑' : result.citationStatus === 'partially-unsupported' ? '部分引用未被观测' : '需要补证'}</small></div><div className="evidence-analysis-grid"><AnalysisColumn title="支持" icon={Check} kind="support" items={bucketItems(analysis.support)} onOpen={openEvidence} evidence={evidence}/><AnalysisColumn title="冲突" icon={GitCompareArrows} kind="conflict" items={bucketItems(analysis.conflicts)} onOpen={openEvidence} evidence={evidence}/><AnalysisColumn title="缺口" icon={CircleAlert} kind="gap" items={bucketItems(analysis.gaps)} onOpen={openEvidence} evidence={evidence}/></div>{analysis.nextSteps?.length > 0 && <div className="evidence-next-steps"><Lightbulb size={15}/><div><b>下一步</b><span>{analysis.nextSteps.join(' · ')}</span></div></div>}{(result.unsupportedEvidenceIds?.length || result.unsupportedSourceRefs?.length) ? <div className="evidence-unsupported"><AlertCircle size={14}/><span>已忽略 {result.unsupportedEvidenceIds?.length || 0} 个未知 evidence ID 和 {result.unsupportedSourceRefs?.length || 0} 个未观测锚点</span></div> : null}</section>}

    {result && <section className="evidence-decision-section"><div className="evidence-section-heading"><span><ShieldCheck size={15}/>决策笔记</span><small>确认前不写入</small></div>{!decisionOpen && !confirmation && <div className="evidence-decision-empty"><div><b>把当前判断保存为受控决策记录</b><span>来源版本、证据 ID 和内容 diff 会绑定到提案。</span></div><button type="button" className="evidence-secondary-button" onClick={() => { setDecisionTitle(`决策记录：${question.slice(0, 42)}`); setDecisionContent(''); setDecisionOpen(true); }}><FileText size={15}/>生成提案</button></div>}{decisionOpen && <div className="evidence-decision-editor"><label><span>标题</span><input value={decisionTitle} onChange={event => setDecisionTitle(event.target.value)} placeholder="决策记录标题"/></label><label><span>内容</span><textarea value={decisionContent} onChange={event => setDecisionContent(event.target.value)} placeholder="留空则使用当前分析自动生成。"/></label><div><button type="button" className="evidence-secondary-button" onClick={() => setDecisionOpen(false)}><X size={14}/>取消</button><button type="button" className="evidence-primary-button" disabled={decisionBusy} onClick={proposeDecision}>{decisionBusy ? <LoaderCircle className="spin" size={15}/> : <ShieldCheck size={15}/>}提交受控提案</button></div></div>}{confirmation && <div className={`evidence-confirmation is-${confirmation.status}`} role="status" aria-live="polite" aria-atomic="true"><div className="evidence-confirmation-head"><span><ShieldCheck size={16}/><b>{confirmation.status === 'pending' ? '决策笔记待确认' : `提案${statusLabel(confirmation.status)}`}</b></span>{confirmation.expiresAt && confirmation.status === 'pending' && <small><Clock3 size={12}/>有效至 {new Date(confirmation.expiresAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</small>}</div>{confirmation.proposal?.diff && <details className="evidence-diff evidence-confirmation-review" open><summary>审阅拟写内容</summary><span>{confirmation.proposal.diff.path || '受控工作区'}</span>{String(confirmation.proposal.diff.before || '').trim() && <div><small>当前内容</small><pre>{String(confirmation.proposal.diff.before)}</pre></div>}<div><small>确认后写入</small><pre>{String(confirmation.proposal.diff.after || confirmation.proposal.diff.content || '提案没有可预览的正文。')}</pre></div></details>}{confirmation.proposal?.sourceRefs?.length > 0 && <div className="evidence-confirmation-sources">{confirmation.proposal.sourceRefs.map((source, index) => <button type="button" key={source.evidenceId || index} onClick={() => openEvidence(source)}><BookOpenCheck size={13}/>[{index + 1}] {source.title}</button>)}</div>}{confirmation.status === 'pending' && <div className="evidence-confirmation-actions"><button type="button" className="evidence-secondary-button" disabled={decisionBusy} onClick={() => confirmDecision(false)}><X size={14}/>拒绝</button><button type="button" className="evidence-primary-button" disabled={decisionBusy} onClick={() => confirmDecision(true)}><Check size={14}/>确认写入</button></div>}{confirmation.status === 'stale' && <p className="evidence-confirmation-warning"><RefreshCw size={14}/>来源或目标已变化，未执行写入。请重新分析。</p>}{confirmation.status === 'failed' && <p className="evidence-confirmation-warning"><AlertCircle size={14}/>写入未完成，当前来源没有被改动。</p>}</div>}</section>}
  </main>;
}

function AnalysisColumn({ title, icon: Icon, kind, items, onOpen, evidence }) {
  const byId = new Map(evidence.map(item => [item.id, item]));
  return <section className={`evidence-analysis-column is-${kind}`}><header><span><Icon size={15}/>{title}</span><b>{items.length}</b></header>{items.length ? <div>{items.map((item, index) => <article key={item.id || index}><p>{item.claim || item.text || item.reason || '待补充判断'}</p>{(item.evidenceIds || []).map(id => { const source = byId.get(id); return source ? <button type="button" key={id} onClick={() => onOpen(source)}><BookOpenCheck size={12}/>{source.title}{source.anchor ? ` · ${source.anchor}` : ''}</button> : null; })}</article>)}</div> : <small className="evidence-column-empty">暂无记录</small>}</section>;
}
