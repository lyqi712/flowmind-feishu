import React from 'react';
import { AlertCircle, CheckCircle2, CircleHelp, History, RefreshCw } from 'lucide-react';
import './EvidenceStatus.css';

const STATUS_META = Object.freeze({
  current: { label: '当前版本', shortLabel: '当前', tone: 'current', Icon: CheckCircle2 },
  stale: { label: '引用的是旧版本', shortLabel: '旧版本', tone: 'stale', Icon: History },
  unavailable: { label: '来源不可用', shortLabel: '不可用', tone: 'unavailable', Icon: AlertCircle },
  unverified: { label: '位置未核验', shortLabel: '未核验', tone: 'unverified', Icon: CircleHelp }
});

const REASON_LABELS = Object.freeze({
  content_version_changed: '原文已经更新，历史引用保持原版本，不会自动改写。',
  document_deleted: '原文已删除或归档，历史引用仍保留但当前无法读取。',
  document_not_found: '原文不在当前本地知识库中，无法确认正文位置。',
  source_location_not_observed: '服务端没有在正文或索引中观察到该锚点或摘录。',
  source_anchor_not_observed: '服务端无法在当前正文或索引中确认这个锚点。',
  source_excerpt_not_observed: '服务端无法在当前正文或索引中确认该摘录。',
  source_version_missing: '该来源没有可验证的版本指纹。'
});

export function evidenceStatusMeta(status) {
  return STATUS_META[String(status || 'unverified')] || STATUS_META.unverified;
}

export function evidenceReasonLabel(reason) {
  return REASON_LABELS[String(reason || '')] || (reason ? `状态原因：${reason}` : '需要重新核验来源。');
}

export function evidenceVersionLabel(version = {}) {
  const revision = version?.revision ? `修订 ${version.revision}` : '';
  const id = version?.id !== null && version?.id !== undefined ? `版本 ${version.id}` : '';
  return [id, revision].filter(Boolean).join(' · ') || '版本信息缺失';
}

export function EvidenceStatusBadge({ evidence, compact = false, className = '' }) {
  if (!evidence) return null;
  const meta = evidenceStatusMeta(evidence.evidenceStatus);
  const Icon = meta.Icon;
  const label = compact ? meta.shortLabel : meta.label;
  return <span className={`evidence-status-badge is-${meta.tone} ${compact ? 'is-compact' : ''} ${className}`.trim()}
    data-evidence-status={meta.tone} title={meta.label} aria-label={meta.label}><Icon size={compact ? 11 : 12}/><span>{label}</span></span>;
}

export function EvidenceStatusNotice({ evidence, versions = [], selectedVersionId = null, historical = false, onOpenCurrent, onOpenVersion }) {
  if (!evidence && !historical) return null;
  const status = evidence?.evidenceStatus || (historical ? 'stale' : 'unverified');
  const meta = evidenceStatusMeta(status);
  const Icon = historical ? History : meta.Icon;
  const sourceVersion = evidence?.sourceVersion || { id: evidence?.contentVersionId, revision: evidence?.revision, contentHash: evidence?.contentHash };
  const currentVersion = evidence?.currentVersion || { id: evidence?.currentVersionId, revision: evidence?.currentRevision, contentHash: evidence?.currentContentHash };
  const hasCurrentVersion = currentVersion.id !== null && currentVersion.id !== undefined;
  const selectableVersions = Array.isArray(versions) ? versions.filter(version => version?.id !== null && version?.id !== undefined) : [];
  const selected = selectedVersionId !== null && selectedVersionId !== undefined ? String(selectedVersionId) : '';
  const message = historical
    ? `正在查看${evidenceVersionLabel(sourceVersion)}的历史正文。历史内容不会被当前版本静默替换。`
    : status === 'stale'
      ? `这条引用来自${evidenceVersionLabel(sourceVersion)}；当前正文是${evidenceVersionLabel(currentVersion)}。`
      : status === 'unavailable'
        ? '原始来源当前不可用，已保留引用的版本、摘要和定位信息。'
        : status === 'current'
          ? '当前正文与来源版本指纹一致，引用定位可回查。'
          : '来源已找到，但服务端尚未核验到可靠的正文定位。';
  const reason = evidence?.evidenceStatusReason
    ? evidenceReasonLabel(evidence.evidenceStatusReason)
    : status === 'current' ? '版本指纹与当前正文一致。' : evidenceReasonLabel(historical ? 'content_version_changed' : '');
  return <section className={`evidence-status-notice is-${meta.tone}`} role="status" aria-live="polite" data-evidence-status={status}>
    <div className="evidence-status-notice-copy"><span className="evidence-status-notice-icon"><Icon size={15}/></span><div><b>{historical ? '历史版本阅读' : meta.label}</b><p>{message}</p><small>{reason}</small></div></div>
    <div className="evidence-status-notice-actions">
      {selectableVersions.length > 0 && onOpenVersion && <label><span>回源版本</span><select value={selected} onChange={event => onOpenVersion(event.target.value)} aria-label="选择回源版本"><option value="">选择版本</option>{selectableVersions.map(version => <option key={version.id} value={version.id}>{evidenceVersionLabel(version)}{String(version.id) === String(currentVersion.id) ? ' · 当前' : ''}</option>)}</select></label>}
      {onOpenCurrent && hasCurrentVersion && (historical || status !== 'current') && <button type="button" onClick={onOpenCurrent}><RefreshCw size={13}/>打开当前版本</button>}
    </div>
  </section>;
}
