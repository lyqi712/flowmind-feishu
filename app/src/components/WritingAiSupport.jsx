import React from 'react';
import { AlertCircle, Check, Link2, LoaderCircle, Plus, Sparkles } from 'lucide-react';

export const WRITING_AI_ACTIONS = Object.freeze([
  { id: 'polish', label: '润色', description: '优化表达、语法和节奏，不改变事实与结构' },
  { id: 'continue', label: '续写', description: '沿用当前上下文继续写下一段内容' },
  { id: 'summarize', label: '总结', description: '提炼重点，生成可直接放入草稿的摘要' },
  { id: 'tone', label: '改写语气', description: '按选定语气改写，同时保留原意和引用' }
]);

export const WRITING_AI_TONES = Object.freeze(['专业简洁', '自然友好', '正式严谨', '清晰有力', '轻松口语']);

export function buildWritingAiPrompt({ action = 'polish', tone = WRITING_AI_TONES[0], title = '', original = '', scope = '全文', sourceRefs = [], template = 'freeform', audience = '' } = {}) {
  const meta = WRITING_AI_ACTIONS.find(item => item.id === action) || WRITING_AI_ACTIONS[0];
  const sources = (Array.isArray(sourceRefs) ? sourceRefs : []).map((ref, index) => {
    const location = ref?.pageNumber ? `第 ${ref.pageNumber} 页` : ref?.anchor || '';
    const excerpt = String(ref?.excerpt || ref?.quote || ref?.snippet || '').replace(/\s+/g, ' ').trim().slice(0, 180);
    return `[${index + 1}] ${ref?.title || '来源资料'}${location ? `（${location}）` : ''}${excerpt ? `：${excerpt}` : ''}`;
  });
  const operation = action === 'continue'
    ? '只输出自然衔接在原文之后的新内容，不要重复原文。'
    : action === 'summarize'
      ? '输出结构清楚、信息密度高的摘要；不得补充原文没有的事实。'
      : action === 'tone'
        ? `将文字改写为“${tone}”语气，保留原意、事实、数字、专有名词和引用。`
        : '修正语病、冗余和不自然表达，使文字更清楚流畅；保留原意、结构、事实和引用。';
  return [
    `你正在执行写作草稿 AI 工作：${meta.label}。`,
    `草稿标题：${title || '无标题草稿'}`,
    `处理范围：${scope}`,
    `写作模板：${template || 'freeform'}；受众：${audience || '未指定'}；目标语气：${tone}`,
    operation,
    '严格要求：只输出可直接写回草稿的 Markdown 正文，不解释生成过程；不要使用 Markdown 代码围栏，不要在正文首尾添加 --- 分隔线；保留原文中的 [数字] 来源标记、URL、[[双向链接]]、代码和待办状态；不得编造事实或来源。',
    sources.length ? `已绑定来源（仅用于保持引用关系）：\n${sources.join('\n')}` : '已绑定来源：无；仅依据下方原文处理。',
    `原文开始\n---\n${String(original || '')}\n---\n原文结束`
  ].join('\n\n');
}

export function normalizeWritingAiResult(value = '') {
  let text = String(value || '').trim();
  const fenced = text.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i);
  if (fenced) text = fenced[1].trim();
  const lines = text.split('\n');
  if (lines.length >= 3 && /^\s*---+\s*$/.test(lines[0]) && /^\s*---+\s*$/.test(lines.at(-1))) text = lines.slice(1, -1).join('\n').trim();
  return text;
}

export function applyWritingAiResult({ content = '', result = '', range = {}, mode = 'replace' } = {}) {
  const source = String(content || '');
  const generated = normalizeWritingAiResult(result);
  if (!generated) throw new Error('AI 结果为空，暂时没有可写入的内容');
  const start = Math.max(0, Math.min(source.length, Number(range?.start) || 0));
  const end = Math.max(start, Math.min(source.length, Number(range?.end) || start));
  if (mode === 'replace') return { content: `${source.slice(0, start)}${generated}${source.slice(end)}`, selection: { start, end: start + generated.length } };
  if (mode !== 'insert') throw new Error(`未知写入方式：${mode}`);
  const before = source.slice(0, end);
  const after = source.slice(end);
  const prefix = !before ? '' : before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  const suffix = !after ? '' : after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n';
  return { content: `${before}${prefix}${generated}${suffix}${after}`, selection: { start: end + prefix.length, end: end + prefix.length + generated.length } };
}

export async function readWritingAiStream(response, { onDelta } = {}) {
  if (!response?.body) {
    const payload = await response?.json?.().catch(() => ({}));
    throw new Error(payload?.error?.message || `AI 写作请求失败（HTTP ${response?.status || 0}）`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let streamed = '';
  let artifact = null;
  let done = null;
  const consume = line => {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (event.type === 'error') throw new Error(event?.error?.message || 'AI 写作失败');
    if (event.type === 'model-delta' || event.type === 'delta') {
      streamed += String(event.delta || '');
      onDelta?.(streamed, event);
    }
    if (event.type === 'artifact') artifact = event.artifact || artifact;
    if (event.type === 'done') done = event;
  };
  try {
    while (true) {
      const { value, done: ended } = await reader.read();
      if (ended) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) consume(line);
    }
    buffer += decoder.decode();
    if (buffer.trim()) consume(buffer);
  } finally { reader.releaseLock(); }
  const finalArtifact = done?.result?.artifact || artifact || {};
  const result = normalizeWritingAiResult(finalArtifact.content || done?.answer || streamed || '');
  if (!response.ok) throw new Error(`AI 写作请求失败（HTTP ${response.status}）`);
  if (!result) throw new Error('模型没有返回可预览的写作结果');
  return { result, citations: finalArtifact.references || finalArtifact.citations || done?.citations || [], model: done?.result?.model || done?.model || finalArtifact.generatedBy || null };
}

export function WritingAiPanel({ writer, sourceRefs = [], onAction, onToneChange, onApply, onClose, onOpenSource }) {
  const references = writer.citations?.length ? writer.citations : sourceRefs;
  const panelStyle = { marginTop: 14, border: '1px solid #f1e8e3', borderRadius: 14, background: '#fdfbfa', padding: 14, display: 'grid', gap: 12 };
  const rowStyle = { display: 'flex', gap: 8, flexWrap: 'wrap' };
  const previewStyle = { margin: 0, maxHeight: 260, overflow: 'auto', whiteSpace: 'pre-wrap', font: 'inherit', lineHeight: 1.65, padding: 12, borderRadius: 10, background: '#fff', border: '1px solid #efede8' };
  const sourceButtonStyle = { display: 'inline-flex', alignItems: 'center', gap: 5, maxWidth: '100%', border: 0, padding: '3px 0', background: 'transparent', color: '#ba6b4f', cursor: 'pointer', textAlign: 'left' };
  return <section aria-label="草稿 AI 写作" data-writing-ai="true" style={panelStyle}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}><Sparkles size={17}/><div style={{ flex: 1 }}><b>草稿 AI 写作</b><small style={{ display: 'block', color: '#978f77', marginTop: 2 }}>当前范围：{writer.scope} · 结果先预览，只有你点击应用后才会修改草稿</small></div><button type="button" onClick={onClose}>关闭</button></div>
    <div style={rowStyle} aria-label="草稿 AI 写作操作">{WRITING_AI_ACTIONS.map(item => <button type="button" key={item.id} aria-pressed={writer.action === item.id} disabled={writer.status === 'loading'} onClick={() => onAction(item.id)} title={item.description}>{item.label}</button>)}</div>
    <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span>改写语气</span><select name="writing-ai-tone" value={writer.tone} disabled={writer.status === 'loading'} onChange={event => onToneChange(event.target.value)}>{WRITING_AI_TONES.map(tone => <option key={tone}>{tone}</option>)}</select></label>
    {writer.status === 'loading' ? <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 8 }}><LoaderCircle className="spin" size={17}/>AI 正在处理，原文保持不变…</div> : null}
    {writer.error ? <div role="alert" style={{ display: 'flex', alignItems: 'flex-start', gap: 8, color: '#b42318' }}><AlertCircle size={17}/><span>{writer.error}</span></div> : null}
    {writer.original ? <details><summary>查看原文快照（{writer.original.length} 字）</summary><pre style={previewStyle}>{writer.original}</pre></details> : null}
    {writer.result ? <div><b>结果预览</b><pre aria-label="草稿 AI 写作结果预览" style={{ ...previewStyle, marginTop: 7 }}>{writer.result}</pre></div> : null}
    {references.length ? <details><summary>来源与引用（{references.length}）</summary><ul>{references.map((ref, index) => {
      const documentId = ref.documentId || ref.contentItemId;
      const label = `${ref.title || `来源 ${index + 1}`}${ref.pageNumber ? ` · 第 ${ref.pageNumber} 页` : ref.anchor ? ` · ${ref.anchor}` : ''}`;
      return <li key={`${ref.id || documentId || 'source'}:${ref.anchor || index}`}>
        {documentId && onOpenSource ? <button type="button" style={sourceButtonStyle} onClick={() => onOpenSource(ref)}><Link2 size={13}/>{label}</button> : label}
      </li>;
    })}</ul></details> : null}
    {writer.status === 'preview' && writer.result ? <div style={rowStyle}><button type="button" onClick={() => onApply('insert')}><Plus size={15}/>插入到原文后</button><button type="button" onClick={() => onApply('replace')}><Check size={15}/>替换{writer.scope}</button></div> : null}
    {writer.status === 'applied' && writer.appliedMode ? <small style={{ color: '#2f7d32' }}>已{writer.appliedMode === 'insert' ? '插入' : '替换'}，原来源引用仍保留</small> : null}
  </section>;
}
