import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Clipboard,
  Cloud,
  Download,
  GitCompareArrows,
  KeyRound,
  Laptop,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Unplug,
  Upload,
  WifiOff,
  X
} from 'lucide-react';
import './WorkspaceSyncPanel.css';

function errorText(error, fallback = '请求失败') {
  return error?.error?.message || error?.message || (typeof error?.error === 'string' ? error.error : '') || fallback;
}

async function requestJson(fetcher, url, options = {}) {
  const response = await fetcher(url, options);
  const text = await response.text();
  let body = {};
  if (text) {
    try { body = JSON.parse(text); } catch { body = { message: text }; }
  }
  if (!response.ok) {
    const error = new Error(errorText(body, `请求失败（${response.status}）`));
    Object.assign(error, body?.error || {}, { status: response.status, body });
    throw error;
  }
  return body;
}

function statusLabel(status) {
  return {
    idle: '未同步',
    ready: '有可检查变化',
    'ready-to-push': '等待首次同步',
    syncing: '同步中',
    synced: '已同步',
    conflict: '需要处理冲突',
    offline: '端点暂不可用',
    error: '配置不可用'
  }[status] || '未同步';
}

function conflictValue(conflict, side) {
  const value = conflict?.[side];
  if (!value) return '暂无记录';
  if (value.deleted) return '已在该设备关闭';
  const item = value;
  if (conflict.collection === 'readingPositions') {
    const progress = Number(item.progress);
    return `${Number.isFinite(progress) ? `${Math.round(progress * 100)}%` : '未记录进度'}${item.anchor ? ` · ${item.anchor}` : ''}`;
  }
  if (conflict.collection === 'tasks') return `${item.title || '未命名任务'} · ${item.status || '未知状态'}`;
  if (conflict.collection === 'tabs') return `${item.title || '未命名标签'} · ${item.resourceId || '无资源'}`;
  if (conflict.collection === 'draftMarkers') return item.dirty ? '有未保存修改' : '已保存';
  if (conflict.collection === 'contextRefs') return `${item.title || '上下文资料'}${item.anchor ? ` · ${item.anchor}` : ''}`;
  return item.title || item.resourceId || '最近工作记录';
}

function sessionSummary(session = {}) {
  return [
    [`标签页`, Array.isArray(session.tabs) ? session.tabs.length : 0],
    [`阅读位置`, Object.keys(session.readingPositions || {}).length],
    [`最近工作`, Array.isArray(session.recentWork) ? session.recentWork.length : 0],
    [`可恢复任务`, Array.isArray(session.tasks) ? session.tasks.filter(task => !['completed', 'failed', 'cancelled'].includes(task.status)).length : 0]
  ];
}

function publicErrorDetails(error) {
  return error?.body?.error?.details || error?.details || {};
}

export function WorkspaceSyncPanel({
  session,
  onSessionChange,
  onToast,
  fetcher = globalThis.fetch
}) {
  const [settings, setSettings] = useState(null);
  const [form, setForm] = useState({ endpoint: '', workspaceId: '', accessToken: '', enabled: false });
  const [pairing, setPairing] = useState(null);
  const [plan, setPlan] = useState(null);
  const [resolutions, setResolutions] = useState({});
  const [pendingImport, setPendingImport] = useState(null);
  const [busy, setBusy] = useState('loading');
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);
  const requestSequence = useRef(0);
  const counts = useMemo(() => sessionSummary(session), [session]);

  const refresh = useCallback(async () => {
    const sequence = ++requestSequence.current;
    setBusy('loading');
    setError(null);
    try {
      const result = await requestJson(fetcher, '/api/workspace-sync/status');
      if (sequence !== requestSequence.current) return;
      const next = result.settings || {};
      setSettings(next);
      setForm(current => ({
        ...current,
        endpoint: next.endpoint || current.endpoint || '',
        workspaceId: next.workspaceId || current.workspaceId || '',
        enabled: Boolean(next.enabled)
      }));
    } catch (requestError) {
      if (sequence === requestSequence.current) setError(requestError);
    } finally {
      if (sequence === requestSequence.current) setBusy('');
    }
  }, [fetcher]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function saveSettings(event) {
    event?.preventDefault?.();
    setBusy('save');
    setError(null);
    try {
      const payload = {
        endpoint: form.endpoint.trim(),
        workspaceId: form.workspaceId.trim(),
        enabled: form.enabled,
        ...(form.accessToken.trim() ? { accessToken: form.accessToken.trim() } : {})
      };
      const result = await requestJson(fetcher, '/api/workspace-sync/settings', {
        method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload)
      });
      setSettings(result.settings);
      setForm(current => ({ ...current, accessToken: '', enabled: Boolean(result.settings?.enabled) }));
      onToast?.(result.settings?.enabled ? '工作现场同步已启用' : '工作现场同步设置已保存');
    } catch (requestError) {
      setError(requestError);
      onToast?.(errorText(requestError), 'error');
    } finally { setBusy(''); }
  }

  async function createRelay() {
    setBusy('pair');
    setError(null);
    try {
      const endpoint = form.endpoint.trim() || globalThis.location?.origin || '';
      const result = await requestJson(fetcher, '/api/workspace-sync/relay', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint })
      });
      const relay = result.relay || {};
      setPairing(relay);
      setForm(current => ({ ...current, endpoint: relay.endpoint || endpoint, workspaceId: relay.workspaceId || '', accessToken: relay.pairingToken || '', enabled: true }));
      const configured = await requestJson(fetcher, '/api/workspace-sync/settings', {
        method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint: relay.endpoint || endpoint, workspaceId: relay.workspaceId, accessToken: relay.pairingToken, enabled: true })
      });
      setSettings(configured.settings);
      setForm(current => ({ ...current, accessToken: '', enabled: true }));
      onToast?.('同步空间已创建；请复制配对密钥到另一台设备');
    } catch (requestError) {
      setError(requestError);
      onToast?.(errorText(requestError), 'error');
    } finally { setBusy(''); }
  }

  async function previewSync() {
    setBusy('preview');
    setError(null);
    setPlan(null);
    setResolutions({});
    try {
      const result = await requestJson(fetcher, '/api/workspace-sync/preview', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ session })
      });
      setPlan(result);
      setSettings(result.settings || settings);
    } catch (requestError) {
      setError(requestError);
      onToast?.(errorText(requestError), 'error');
    } finally { setBusy(''); }
  }

  async function applySync() {
    const unresolvedNow = plan?.plan?.conflicts?.filter(conflict => !resolutions[conflict.id]) || [];
    if (!plan?.plan || unresolvedNow.length > 0) return;
    setBusy('apply');
    setError(null);
    try {
      const result = await requestJson(fetcher, '/api/workspace-sync/apply', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ session, resolutions, expectedRevision: plan.remoteRevision })
      });
      onSessionChange?.(result.session);
      setPlan(result);
      setSettings(result.settings || settings);
      setResolutions({});
      onToast?.('工作现场已同步并恢复');
    } catch (requestError) {
      const details = publicErrorDetails(requestError);
      if (Array.isArray(details.conflicts) && details.conflicts.length) setPlan(current => current ? { ...current, plan: { ...current.plan, conflicts: details.conflicts, unresolvedConflicts: details.conflicts, canApply: false } } : current);
      setError(requestError);
      onToast?.(errorText(requestError), 'error');
    } finally { setBusy(''); }
  }

  async function exportBundle() {
    setBusy('export');
    setError(null);
    try {
      const bundle = await requestJson(fetcher, '/api/workspace-sync/bundle/export', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ session })
      });
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'flowmind-workspace-bundle.json';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      onToast?.('工作现场包已导出');
    } catch (requestError) {
      setError(requestError);
      onToast?.(errorText(requestError), 'error');
    } finally { setBusy(''); }
  }

  async function importBundle(event) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    setBusy('import');
    setError(null);
    try {
      const bundle = JSON.parse(await file.text());
      const result = await requestJson(fetcher, '/api/workspace-sync/bundle/import', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ bundle })
      });
      setPendingImport(result.session);
    } catch (requestError) {
      setError(requestError);
      onToast?.(errorText(requestError), 'error');
    } finally { setBusy(''); }
  }

  function confirmImport() {
    if (!pendingImport) return;
    onSessionChange?.(pendingImport);
    setPendingImport(null);
    onToast?.('已恢复工作现场；知识内容和凭据未被修改');
  }

  async function copyPairing() {
    const value = pairing?.pairingToken || '';
    if (!value) return;
    try {
      await navigator.clipboard?.writeText(value);
      onToast?.('配对密钥已复制');
    } catch {
      onToast?.('复制失败，请手动选择配对密钥', 'error');
    }
  }

  const unresolved = plan?.plan?.conflicts?.filter(conflict => !resolutions[conflict.id]) || [];
  const configured = Boolean(settings?.configured);
  const busyNow = Boolean(busy);
  return (
    <section className="workspace-sync-panel" data-workspace-sync-panel aria-labelledby="workspace-sync-title">
      <header className="workspace-sync-panel-heading">
        <div className="workspace-sync-panel-icon"><Cloud size={20} aria-hidden="true" /></div>
        <div><span className="settings-experience-eyebrow">WORKSPACE CONTINUITY</span><h2 id="workspace-sync-title">工作现场同步</h2><p>只同步可恢复的工作台元数据，不同步知识正文、聊天消息、附件或密钥。</p></div>
        <span className={`workspace-sync-status is-${settings?.lastStatus || 'idle'}`}><i />{statusLabel(settings?.lastStatus)}</span>
      </header>

      {error && <div className="workspace-sync-error" role="alert"><AlertCircle size={16} aria-hidden="true" /><span>{errorText(error)}</span><button type="button" aria-label="关闭同步错误" onClick={() => setError(null)}><X size={14} aria-hidden="true" /></button></div>}

      <div className="workspace-sync-scope" aria-label="本机工作现场摘要">
        <div><Laptop size={16} aria-hidden="true" /><span><b>本机现场</b><small>当前设备立即保存</small></span></div>
        {counts.map(([label, value]) => <span key={label}><b>{value}</b><small>{label}</small></span>)}
      </div>

      <div className="workspace-sync-actions">
        <button type="button" className="settings-experience-secondary" onClick={exportBundle} disabled={busyNow}><Download size={15} aria-hidden="true" />导出工作现场包</button>
        <button type="button" className="settings-experience-secondary" onClick={() => fileInputRef.current?.click()} disabled={busyNow}><Upload size={15} aria-hidden="true" />导入并预览</button>
        <input ref={fileInputRef} type="file" accept="application/json,.json" onChange={importBundle} aria-label="选择工作现场包" />
      </div>

      <form className="workspace-sync-config" onSubmit={saveSettings}>
        <div className="workspace-sync-config-title"><div><KeyRound size={16} aria-hidden="true" /><span><b>连接同步端点</b><small>{configured ? `空间 ${settings.workspaceId}` : '可连接自托管或兼容 HTTP relay'}</small></span></div><label className="workspace-sync-toggle"><input type="checkbox" checked={form.enabled} onChange={event => setForm(current => ({ ...current, enabled: event.target.checked }))} /><span>启用</span></label></div>
        <div className="workspace-sync-fields">
          <label><span>端点地址</span><input value={form.endpoint} onChange={event => setForm(current => ({ ...current, endpoint: event.target.value }))} placeholder="https://sync.example.com" inputMode="url" autoComplete="url" /></label>
          <label><span>同步空间</span><input value={form.workspaceId} onChange={event => setForm(current => ({ ...current, workspaceId: event.target.value }))} placeholder="workspace_xxx" autoComplete="off" /></label>
          <label className="workspace-sync-token"><span>配对密钥</span><input type="password" value={form.accessToken} onChange={event => setForm(current => ({ ...current, accessToken: event.target.value }))} placeholder={settings?.accessTokenConfigured ? '已保存，留空保持不变' : '粘贴一次后自动清空'} autoComplete="new-password" /><small><ShieldCheck size={12} aria-hidden="true" />只提交给本机服务，保存后不回显</small></label>
        </div>
        <div className="workspace-sync-config-actions"><button type="submit" className="settings-experience-secondary" disabled={busyNow}><Check size={15} aria-hidden="true" />保存设置</button><button type="button" className="settings-experience-primary" onClick={previewSync} disabled={busyNow || !configured}><RefreshCw size={15} className={busy === 'preview' ? 'is-spinning' : ''} aria-hidden="true" />检查远端变化</button></div>
      </form>

      {!configured && <div className="workspace-sync-empty"><Unplug size={18} aria-hidden="true" /><div><b>同步默认关闭</b><p>先创建一个同步空间，或填写已有端点和配对密钥。</p></div><button type="button" className="settings-experience-primary" onClick={createRelay} disabled={busyNow}><Cloud size={15} aria-hidden="true" />创建同步空间</button></div>}

      {pairing?.pairingToken && <section className="workspace-sync-pairing" aria-label="同步空间配对信息"><div><b>配对密钥只显示这一次</b><small>在另一台设备填写同一端点、同步空间和密钥。关闭窗口后无法再次查看。</small></div><code>{pairing.pairingToken}</code><button type="button" onClick={copyPairing} aria-label="复制配对密钥"><Clipboard size={15} aria-hidden="true" />复制</button></section>}

      {plan && <section className={`workspace-sync-plan is-${plan.status || 'ready'}`} aria-live="polite"><div className="workspace-sync-plan-head"><div><GitCompareArrows size={17} aria-hidden="true" /><span><b>{plan.remoteMissing ? '远端尚无工作现场' : plan.plan?.conflicts?.length ? '发现需要确认的变化' : '可以安全合并'}</b><small>{plan.remoteMissing ? '首次同步会创建远端快照' : `远端版本 ${plan.remoteRevision ?? 0}`}</small></span></div><span>{plan.plan?.stats?.conflicts || 0} 个冲突</span></div>{plan.plan?.conflicts?.length > 0 && <div className="workspace-sync-conflicts">{plan.plan.conflicts.map(conflict => <article key={conflict.id}><header><b>{conflict.label}</b><small>{conflict.key}</small></header><div><button type="button" className={resolutions[conflict.id] === 'local' ? 'is-selected' : ''} onClick={() => setResolutions(current => ({ ...current, [conflict.id]: 'local' }))}><Laptop size={13} aria-hidden="true" /><span><small>本机</small><b>{conflictValue(conflict, 'local')}</b></span></button><button type="button" className={resolutions[conflict.id] === 'remote' ? 'is-selected' : ''} onClick={() => setResolutions(current => ({ ...current, [conflict.id]: 'remote' }))}><Cloud size={13} aria-hidden="true" /><span><small>远端</small><b>{conflictValue(conflict, 'remote')}</b></span></button></div></article>)}</div>}<footer><span>{unresolved.length ? `还有 ${unresolved.length} 个冲突未选择` : '合并结果不会改变知识正文或凭据'}</span><button type="button" className="settings-experience-primary" onClick={applySync} disabled={busyNow || !plan?.plan || unresolved.length > 0}><Cloud size={15} aria-hidden="true" />同步并恢复</button></footer></section>}

      {pendingImport && <section className="workspace-sync-import-preview" role="dialog" aria-labelledby="workspace-sync-import-title"><div><CheckCircle2 size={18} aria-hidden="true" /><span><b id="workspace-sync-import-title">工作现场包已校验</b><small>确认后会替换本机工作台状态；知识内容、笔记正文和凭据不变。</small></span></div><div><button type="button" className="settings-experience-secondary" onClick={() => setPendingImport(null)}><X size={14} aria-hidden="true" />取消</button><button type="button" className="settings-experience-primary" onClick={confirmImport}><Check size={14} aria-hidden="true" />确认恢复</button></div></section>}

      {busy === 'loading' && <div className="workspace-sync-loading" role="status"><LoaderCircle size={16} className="is-spinning" aria-hidden="true" />正在读取同步状态</div>}
      {settings?.lastStatus === 'offline' && <div className="workspace-sync-offline" role="status"><WifiOff size={15} aria-hidden="true" /><span>远端暂不可用，本机工作现场仍可继续使用；恢复网络后再检查。</span></div>}
    </section>
  );
}
