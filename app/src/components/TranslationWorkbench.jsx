import React from 'react';
import { Check, ClipboardCopy, Download, Languages, LoaderCircle, Save, X } from 'lucide-react';
import { EvidenceStatusBadge, evidenceReasonLabel } from './EvidenceStatus.jsx';

const LANGUAGES = ['简体中文', 'English', '日本語', '한국어', 'Français', 'Deutsch', 'Español'];
function sameAnchor(left, right) {
  const normalize = value => String(value || '').match(/(?:page:\d+:)?region:\d+|time:[\d.]+-[\d.]+|page:\d+(?::chars:[\d-]+)?|chars:\d+/)?.[0] || String(value || '');
  return normalize(left) && normalize(left) === normalize(right);
}

export function TranslationWorkbench({ translation, translations = [], sourceLanguage, targetLanguage, provider, glossary, busy, dirty, activeAnchor, onChangeSettings, onSelect, onGenerate, onSave, onClose, onLocate, onUpdateSegment, onExport, onToast }) {
  const segments = translation?.segments || [];
  const sourceRefs = Array.isArray(translation?.sourceRefs) ? translation.sourceRefs : [];
  const evidenceForRow = row => sourceRefs.find(ref => String(ref?.anchor || '') === String(row?.anchor || '') && (row?.anchor || ref?.excerpt))
    || sourceRefs[Number(row?.index) || 0]
    || null;
  const translationEvidence = sourceRefs.find(ref => ref?.evidenceStatus && ref.evidenceStatus !== 'current') || sourceRefs[0] || null;
  const translationEvidenceMessage = translationEvidence && translationEvidence.evidenceStatus !== 'current'
    ? evidenceReasonLabel(translationEvidence.evidenceStatusReason)
    : '';
  async function copyTranslation() {
    const text = segments.map(row => row.translatedText).filter(Boolean).join('\n\n');
    if (!text) return;
    await navigator.clipboard.writeText(text);
    onToast?.('译文已复制到剪贴板');
  }
  return <section className="translation-workbench">
    <header className="translation-head">
      <div><span><Languages size={17}/></span><div><b>对照翻译</b>{translationEvidence && <EvidenceStatusBadge evidence={translationEvidence} compact />}<small>段落与原文 page / region / time 引用保持联动</small>{translationEvidenceMessage && <small className="translation-evidence-warning">{translationEvidenceMessage}</small>}</div></div>
      <button type="button" className="translation-close" onClick={onClose} title="返回原文" aria-label="返回原文"><X size={16}/></button>
    </header>
    <div className="translation-controls">
      <label><span>历史版本</span><select value={translation?.id || ''} onChange={event => onSelect?.(event.target.value)}><option value="">新建翻译</option>{translations.map(item => <option key={item.id} value={item.id}>{item.targetLanguage} · {new Date(item.updatedAt).toLocaleString('zh-CN', { hour12: false })}</option>)}</select></label>
      <label><span>源语言</span><select value={sourceLanguage} onChange={event => onChangeSettings({ sourceLanguage: event.target.value })}><option>自动检测</option>{LANGUAGES.map(language => <option key={language}>{language}</option>)}</select></label>
      <label><span>目标语言</span><select value={targetLanguage} onChange={event => onChangeSettings({ targetLanguage: event.target.value })}>{LANGUAGES.map(language => <option key={language}>{language}</option>)}</select></label>
      <label><span>翻译引擎</span><select value={provider} onChange={event => onChangeSettings({ provider: event.target.value })}><option value="auto">当前模型 Provider</option><option value="local">离线可编辑草稿</option></select></label>
    </div>
    <label className="translation-glossary"><span>术语表</span><textarea value={glossary} onChange={event => onChangeSettings({ glossary: event.target.value })} placeholder="每行一个术语，例如：Owner=负责人；FlowMind 保持不翻译"/></label>
    <div className="translation-actions">
      <button type="button" className="primary" disabled={busy === 'generate'} onClick={onGenerate}>{busy === 'generate' ? <LoaderCircle className="spin" size={15}/> : <Languages size={15}/>}生成对照翻译</button>
      <button type="button" disabled={!translation || !dirty || busy === 'save'} onClick={onSave}>{busy === 'save' ? <LoaderCircle className="spin" size={15}/> : <Save size={15}/>}保存修改</button>
      <button type="button" disabled={!segments.length} onClick={copyTranslation}><ClipboardCopy size={15}/>复制译文</button>
      <button type="button" disabled={!translation} onClick={() => onExport?.('markdown')}><Download size={15}/>Markdown</button>
      <button type="button" disabled={!translation} onClick={() => onExport?.('html')}><Download size={15}/>HTML</button>
      {translation && <small className={translation.fallbackUsed ? 'fallback' : ''}>{translation.fallbackUsed ? '当前为离线可编辑草稿' : `${translation.provider || '模型'} · ${segments.length} 个段落`}</small>}
    </div>
    {segments.length ? <div className="translation-table">
      <div className="translation-table-head"><b>原文</b><b>译文</b></div>
      {segments.map((row, index) => { const evidence = evidenceForRow(row); return <article key={`${row.anchor || index}-${index}`} className={sameAnchor(activeAnchor, row.anchor) ? 'active' : ''}>
        <button type="button" className="translation-source" title={evidence?.evidenceStatusReason ? evidenceReasonLabel(evidence.evidenceStatusReason) : '打开原文定位'} onClick={() => onLocate?.(row.anchor, row.pageNumber)}><small>{row.anchor || `片段 ${index + 1}`} {evidence && <EvidenceStatusBadge evidence={evidence} compact />}{row.speaker ? ` · ${row.speaker}` : ''}</small><p>{row.sourceText}</p></button>
        <label className="translation-target"><span>{row.translatedText && <Check size={13}/>}译文 {index + 1}</span><textarea value={row.translatedText || ''} onFocus={() => onLocate?.(row.anchor, row.pageNumber)} onChange={event => onUpdateSegment?.(index, event.target.value)}/></label>
      </article>; })}
    </div> : <div className="translation-empty"><Languages size={30}/><b>生成第一份对照翻译</b><p>将按当前文档的 Chunk、PDF 页、OCR 区域或音频时间戳拆分，并保留可点击定位。</p></div>}
  </section>;
}