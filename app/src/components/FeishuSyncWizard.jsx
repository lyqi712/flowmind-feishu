import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle, ArrowLeft, ArrowRight, BookOpen, Check, CheckCircle2, ChevronRight,
  Circle, Database, Eye, EyeOff, FileSpreadsheet, FileText, Folder, Globe2,
  KeyRound, Layers3, Link2, LoaderCircle, Network, RefreshCw, RotateCcw, Save,
  ShieldCheck, Sparkles, Table2, X
} from 'lucide-react';
import './FeishuSyncWizard.css';
import { startFeishuUserLogin } from '../workspace/feishu-login.js';

const STEPS = [
  { id: 'credentials', label: '连接应用', hint: 'App ID 与 Secret' },
  { id: 'sources', label: '发现来源', hint: '链接与知识空间' },
  { id: 'scope', label: '同步范围', hint: '递归和数量限制' },
  { id: 'result', label: '同步结果', hint: '统计、警告与重试' }
];
const DEFAULT_FORM = {
  appId: '', appSecret: '', documentUrlsText: '', spaceIds: [], recursiveLinks: true,
  maxDepth: 2, maxDocuments: 200
};
const TYPE_META = {
  docx: { label: 'Docx', icon: FileText, color: 'blue' }, doc: { label: 'Doc', icon: FileText, color: 'blue' },
  wiki: { label: 'Wiki', icon: BookOpen, color: 'purple' }, sheet: { label: 'Sheet', icon: FileSpreadsheet, color: 'green' },
  bitable: { label: 'Bitable', icon: Table2, color: 'orange' }, folder: { label: 'Folder', icon: Folder, color: 'gold' },
  slides: { label: 'Slides', icon: Layers3, color: 'pink' }, mindnote: { label: 'MindNote', icon: Network, color: 'cyan' },
  file: { label: 'File', icon: FileText, color: 'gray' }, unknown: { label: '链接', icon: Link2, color: 'gray' }
};
const PROGRESS_PHASES = [
  { at: 8, label: '正在验证飞书授权' }, { at: 24, label: '正在发现知识空间和链接资源' },
  { at: 45, label: '正在递归遍历文件夹与 Wiki 节点' }, { at: 68, label: '正在拉取文档、表格和多维表格内容' },
  { at: 86, label: '正在写入本地索引' }
];

function toList(value) {
  return [...new Set(String(value || '').split(/[\r\n,;]+/).map(item => item.trim()).filter(Boolean))];
}
function resourceType(value) {
  try {
    const part = new URL(value).pathname.split('/').filter(Boolean)[0]?.toLowerCase();
    return ({ docs: 'doc', doc: 'doc', docx: 'docx', wiki: 'wiki', sheets: 'sheet', sheet: 'sheet', base: 'bitable', bitable: 'bitable', folder: 'folder', file: 'file', slides: 'slides', mindnotes: 'mindnote' })[part] || 'unknown';
  } catch { return 'unknown'; }
}
function errorText(error, fallback = '请求失败') {
  return error?.error?.message || error?.message || (typeof error?.error === 'string' ? error.error : '') || fallback;
}
async function jsonRequest(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data = {};
  if (text) try { data = JSON.parse(text); } catch { data = { message: text }; }
  if (!response.ok) {
    const error = new Error(errorText(data, `HTTP ${response.status}`));
    Object.assign(error, data.error && typeof data.error === 'object' ? data.error : {}, { status: response.status });
    throw error;
  }
  return data;
}
function normalizeSettings(data = {}) {
  const source = data.settings || data;
  return {
    configured: Boolean(source.configured), credentialsConfigured: Boolean(source.credentialsConfigured),
    appIdMasked: source.appIdMasked || '', user: source.user || { loggedIn: false }, documentUrls: Array.isArray(source.documentUrls) ? source.documentUrls : [],
    spaceIds: Array.isArray(source.spaceIds) ? source.spaceIds.map(String) : [],
    folderTokens: Array.isArray(source.folderTokens) ? source.folderTokens : [],
    recursiveLinks: source.recursiveLinks !== false, maxDepth: Number(source.maxDepth ?? 2),
    maxDocuments: Number(source.maxDocuments ?? 200), sourceCount: Number(source.sourceCount || 0)
  };
}
function warningList(result) {
  const warnings = Array.isArray(result?.warnings) ? [...result.warnings] : [];
  if (result?.warning) warnings.unshift(result.warning);
  return warnings.map((item, index) => typeof item === 'string' ? { id: index, message: item } : { id: index, ...item, message: item?.message || item?.code || '同步警告' });
}

export default function FeishuSyncWizard({ onClose, onState, onToast, currentSync }) {
  const [step, setStep] = useState(0);
  const [settings, setSettings] = useState(normalizeSettings());
  const [form, setForm] = useState(DEFAULT_FORM);
  const [showSecret, setShowSecret] = useState(false);
  const [spaces, setSpaces] = useState([]);
  const [discoveredSources, setDiscoveredSources] = useState([]);
  const [busy, setBusy] = useState('loading');
  const [error, setError] = useState(null);
  const [syncResult, setSyncResult] = useState(null);
  const [progress, setProgress] = useState({ percent: 0, label: '准备同步' });
  const [lastSource, setLastSource] = useState('feishu');
  const progressTimer = useRef(null);

  const links = useMemo(() => toList(form.documentUrlsText), [form.documentUrlsText]);
  const typedLinks = useMemo(() => links.map(url => ({ url, type: resourceType(url) })), [links]);
  const counts = useMemo(() => typedLinks.reduce((result, item) => ({ ...result, [item.type]: (result[item.type] || 0) + 1 }), {}), [typedLinks]);
  const canClose = !['saving', 'discovering', 'syncing'].includes(busy);

  useEffect(() => {
    let alive = true;
    jsonRequest('/api/settings/feishu').then(data => {
      if (!alive) return;
      const next = normalizeSettings(data);
      setSettings(next);
      setForm(current => ({ ...current, documentUrlsText: next.documentUrls.join('\n'), spaceIds: next.spaceIds, recursiveLinks: next.recursiveLinks, maxDepth: next.maxDepth, maxDocuments: next.maxDocuments }));
      setStep(next.credentialsConfigured ? 1 : 0);
    }).catch(requestError => alive && setError(requestError)).finally(() => alive && setBusy(''));
    return () => { alive = false; clearInterval(progressTimer.current); };
  }, []);

  function notify(message, kind = 'success') { onToast?.(message, kind); }
  async function loginFeishuUser() {
    setBusy('oauth');
    setError(null);
    try { await startFeishuUserLogin(); }
    catch (requestError) { setError(requestError); setBusy(''); }
  }
  function goTo(next) {
    if (next > 0 && !settings.credentialsConfigured) return;
    setError(null); setStep(Math.max(0, Math.min(3, next)));
  }
  function payload(includeCredentials = false) {
    return {
      ...(includeCredentials ? { appId: form.appId.trim(), appSecret: form.appSecret } : {}),
      documentUrls: links, spaceIds: form.spaceIds, recursiveLinks: form.recursiveLinks,
      maxDepth: Number(form.maxDepth), maxDocuments: Number(form.maxDocuments)
    };
  }

  async function saveCredentials() {
    if (!form.appId.trim() && !settings.credentialsConfigured) return setError(new Error('请输入飞书 App ID'));
    if (!form.appSecret && !settings.credentialsConfigured) return setError(new Error('请输入飞书 App Secret'));
    setBusy('saving'); setError(null);
    try {
      const data = await jsonRequest('/api/settings/feishu', {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...(form.appId.trim() ? { appId: form.appId.trim() } : {}), ...(form.appSecret ? { appSecret: form.appSecret } : {}) })
      });
      const next = normalizeSettings(data);
      setSettings(next); setForm(current => ({ ...current, appId: '', appSecret: '' })); setShowSecret(false);
      notify('飞书应用凭据已安全保存'); setStep(1);
    } catch (requestError) { setError(requestError); }
    finally { setBusy(''); }
  }

  async function discover() {
    setBusy('discovering'); setError(null);
    try {
      const data = await jsonRequest('/api/feishu/discover', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload(false))
      });
      const foundSpaces = Array.isArray(data.spaces) ? data.spaces : [];
      setSpaces(foundSpaces); setDiscoveredSources(Array.isArray(data.sources) ? data.sources : []);
      setForm(current => ({ ...current, spaceIds: current.spaceIds.length ? current.spaceIds : foundSpaces.map(item => String(item.id)) }));
      if (data.settings) setSettings(normalizeSettings(data.settings));
      notify(`授权成功，发现 ${foundSpaces.length} 个知识空间和 ${(data.sources || []).length} 个链接来源`);
    } catch (requestError) { setError(requestError); }
    finally { setBusy(''); }
  }

  async function saveSources(moveNext = true) {
    if (!links.length && !form.spaceIds.length) return setError(new Error('请至少粘贴一个飞书链接或选择一个知识空间'));
    setBusy('saving'); setError(null);
    try {
      const data = await jsonRequest('/api/settings/feishu', {
        method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload(false))
      });
      setSettings(normalizeSettings(data)); notify('飞书来源和同步范围已保存');
      if (moveNext) setStep(2);
      return data;
    } catch (requestError) { setError(requestError); throw requestError; }
    finally { setBusy(''); }
  }

  function startProgress(source) {
    clearInterval(progressTimer.current);
    const started = Date.now();
    setProgress({ percent: 4, label: source === 'mock' ? '正在载入演示知识库' : PROGRESS_PHASES[0].label });
    progressTimer.current = setInterval(() => {
      const elapsed = Date.now() - started;
      const percent = Math.min(92, 4 + Math.floor(elapsed / 230));
      const phase = source === 'mock' ? { label: '正在生成演示数据和索引' } : [...PROGRESS_PHASES].reverse().find(item => percent >= item.at) || PROGRESS_PHASES[0];
      setProgress({ percent, label: phase.label });
    }, 350);
  }

  async function runSync(source = 'feishu') {
    setBusy('syncing'); setError(null); setSyncResult(null); setLastSource(source); setStep(3); startProgress(source);
    try {
      if (source === 'feishu') {
        await jsonRequest('/api/settings/feishu', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload(false)) });
      }
      const data = await jsonRequest('/api/sync', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(source === 'mock' ? { source: 'mock', mode: 'mock' } : { source: 'feishu', mode: 'feishu', ...payload(false) })
      });
      clearInterval(progressTimer.current); setProgress({ percent: 100, label: '同步完成，本地知识索引已更新' });
      setSyncResult(data); if (data.state) onState?.(data.state);
      notify(source === 'mock' ? '演示知识库已载入' : `飞书同步完成，导入 ${data.stats?.imported ?? data.documents?.length ?? 0} 篇内容`);
    } catch (requestError) {
      clearInterval(progressTimer.current); setProgress(current => ({ ...current, label: '同步中断' })); setError(requestError);
    } finally { setBusy(''); }
  }

  const activeStep = STEPS[step];
  return <div className="feishu-wizard-backdrop" onMouseDown={() => canClose && onClose?.()}>
    <section className="feishu-wizard" onMouseDown={event => event.stopPropagation()}>
      <header className="fw-header">
        <div className="fw-brand"><span><Sparkles size={21}/></span><div><small>FEISHU CONNECTOR</small><h2>飞书知识库连接向导</h2><p>连接应用、发现内容来源，并建立可持续更新的本地知识索引。</p></div></div>
        <button type="button" className="fw-close" aria-label="关闭飞书连接向导" disabled={!canClose} onClick={onClose}><X size={20}/></button>
      </header>
      <div className="fw-layout">
        <aside className="fw-steps">
          {STEPS.map((item, index) => <button key={item.id} className={`${step === index ? 'active' : ''} ${index < step || (index === 0 && settings.credentialsConfigured) ? 'done' : ''}`} disabled={index > 0 && !settings.credentialsConfigured} onClick={() => goTo(index)}>
            <span>{index < step || (index === 0 && settings.credentialsConfigured) ? <Check size={14}/> : index + 1}</span><div><b>{item.label}</b><small>{item.hint}</small></div>{step === index && <ChevronRight size={14}/>}</button>)}
          <div className="fw-security"><ShieldCheck size={18}/><div><b>凭据安全</b><p>Secret 加密保存于服务端，前端保存后立即清空且永不回显。</p></div></div>
          <button className="fw-mock" disabled={busy === 'syncing'} onClick={() => runSync('mock')}><Database size={16}/><span><b>演示模式</b><small>无需飞书凭据</small></span></button>
        </aside>
        <main className="fw-main">
          <div className="fw-step-heading"><span>步骤 {step + 1} / {STEPS.length}</span><h3>{activeStep.label}</h3><p>{activeStep.hint}</p></div>
          {busy === 'loading' ? <WizardLoading/> : <>
            {step === 0 && <CredentialsStep form={form} setForm={setForm} settings={settings} busy={busy} error={error} showSecret={showSecret} setShowSecret={setShowSecret} save={saveCredentials} login={loginFeishuUser}/>}
            {step === 1 && <SourcesStep form={form} setForm={setForm} typedLinks={typedLinks} counts={counts} spaces={spaces} discoveredSources={discoveredSources} busy={busy} error={error} discover={discover} next={() => saveSources(true)}/>}
            {step === 2 && <ScopeStep form={form} setForm={setForm} settings={settings} links={typedLinks} spaces={spaces.filter(space => form.spaceIds.includes(String(space.id)))} error={error} busy={busy} back={() => goTo(1)} save={() => saveSources(false)} sync={() => runSync('feishu')}/>}
            {step === 3 && <ResultStep busy={busy} progress={progress} result={syncResult} error={error} currentSync={currentSync} retry={() => runSync(lastSource)} back={() => goTo(lastSource === 'mock' ? 0 : 2)} close={onClose}/>}
          </>}
        </main>
      </div>
    </section>
  </div>;
}

function WizardLoading() {
  return <div className="fw-loading"><LoaderCircle className="spin" size={25}/><b>正在读取飞书连接设置</b><small>Secret 不会被下载到浏览器</small></div>;
}
function ErrorBanner({ error }) {
  if (!error) return null;
  return <div className="fw-error"><AlertCircle size={16}/><div><b>{errorText(error)}</b><small>{error.stage ? `阶段：${error.stage}` : '请检查配置后重试'}{error.code ? ` · ${error.code}` : ''}</small></div></div>;
}
function CredentialsStep({ form, setForm, settings, busy, error, showSecret, setShowSecret, save, login }) {
  return <div className="fw-pane"><div className="fw-info-card"><KeyRound size={20}/><div><b>{settings.credentialsConfigured ? '应用凭据已配置' : '首次连接需要飞书自建应用凭据'}</b><p>{settings.credentialsConfigured ? `当前 App ID：${settings.appIdMasked}` : '在飞书开放平台创建自建应用，并授予 Wiki、云文档、电子表格和多维表格只读权限。'}</p></div>{settings.credentialsConfigured && <CheckCircle2 size={19}/>}</div>
    {settings.credentialsConfigured && <div className="fw-info-card"><ShieldCheck size={20}/><div><b>{settings.user?.loggedIn ? `已登录飞书${settings.user.name ? ` · ${settings.user.name}` : ''}` : '登录飞书账号拉图'}</b><p>{settings.user?.loggedIn ? '应用无权下载的图片，会按你的账号权限再试一次。' : '部分文档应用读得了正文、下不了图。登录后把当前站点 /api/feishu/oauth/callback 加到开放平台重定向 URL。'}</p></div>{settings.user?.loggedIn ? <CheckCircle2 size={19}/> : <button type="button" className="fw-primary" disabled={busy === 'oauth'} onClick={login}>{busy === 'oauth' ? '正在打开飞书' : '登录飞书'}</button>}</div>}
    <div className="fw-form-card"><label><span>App ID</span><input value={form.appId} onChange={event => setForm(current => ({ ...current, appId: event.target.value }))} placeholder={settings.appIdMasked || 'cli_xxx'} autoComplete="off"/><small>{settings.credentialsConfigured ? '留空继续使用已保存的 App ID。' : '飞书开放平台 → 凭证与基础信息。'}</small></label>
      <label><span>App Secret</span><div className="fw-password"><input type={showSecret ? 'text' : 'password'} value={form.appSecret} onChange={event => setForm(current => ({ ...current, appSecret: event.target.value }))} placeholder={settings.credentialsConfigured ? '留空继续使用已保存的 Secret' : '输入 App Secret'} autoComplete="new-password"/><button type="button" aria-label={showSecret ? '隐藏 App Secret' : '显示 App Secret'} onClick={() => setShowSecret(!showSecret)}>{showSecret ? <EyeOff size={16}/> : <Eye size={16}/>}</button></div><small>保存后此输入框立即清空；后端只返回“已配置”状态。</small></label>
    </div><ErrorBanner error={error}/><div className="fw-actions"><span/><button className="fw-primary" disabled={busy === 'saving'} onClick={save}>{busy === 'saving' ? <LoaderCircle className="spin" size={16}/> : <Save size={16}/>}保存凭据并继续<ArrowRight size={15}/></button></div>
  </div>;
}
function SourcesStep({ form, setForm, typedLinks, counts, spaces, discoveredSources, busy, error, discover, next }) {
  function toggleSpace(id) {
    setForm(current => ({ ...current, spaceIds: current.spaceIds.includes(id) ? current.spaceIds.filter(item => item !== id) : [...current.spaceIds, id] }));
  }
  return <div className="fw-pane"><section className="fw-source-card"><div className="fw-section-title"><div><Link2 size={17}/><span><b>粘贴任意飞书链接</b><small>支持 Docx、Wiki、Sheet、Bitable、Folder，可混合输入</small></span></div>{typedLinks.length > 0 && <em>{typedLinks.length} 个来源</em>}</div><textarea value={form.documentUrlsText} onChange={event => setForm(current => ({ ...current, documentUrlsText: event.target.value }))} placeholder={'每行粘贴一个飞书链接，例如：\nhttps://example.feishu.cn/docx/xxxx\nhttps://example.feishu.cn/wiki/xxxx\nhttps://example.feishu.cn/sheets/xxxx\nhttps://example.feishu.cn/base/xxxx\nhttps://example.feishu.cn/folder/xxxx'}/>
      {typedLinks.length > 0 && <div className="fw-type-summary">{Object.entries(counts).map(([type, count]) => <TypePill key={type} type={type} count={count}/>)}</div>}
    </section>
    <button className="fw-discover" disabled={busy === 'discovering'} onClick={discover}>{busy === 'discovering' ? <LoaderCircle className="spin" size={18}/> : <Globe2 size={18}/>}<span><b>{busy === 'discovering' ? '正在验证授权并发现来源' : '测试连接并发现可访问空间'}</b><small>调用飞书开放平台，不会修改任何远端内容</small></span><ChevronRight size={16}/></button>
    {discoveredSources.length > 0 && <section className="fw-discovered"><div className="fw-section-title"><div><CheckCircle2 size={17}/><span><b>已识别链接</b><small>飞书已确认以下资源可访问</small></span></div></div><div>{discoveredSources.map((source, index) => <div key={`${source.url}-${index}`}><TypePill type={source.type}/><span><b>{source.title || `${TYPE_META[source.type]?.label || source.type} · …${source.tokenSuffix}`}</b><small>{source.url}</small></span><Check size={15}/></div>)}</div></section>}
    {spaces.length > 0 && <section className="fw-spaces"><div className="fw-section-title"><div><BookOpen size={17}/><span><b>可访问知识空间</b><small>已自动选中发现的空间，可按需取消</small></span></div><button onClick={() => setForm(current => ({ ...current, spaceIds: current.spaceIds.length === spaces.length ? [] : spaces.map(space => String(space.id)) }))}>{form.spaceIds.length === spaces.length ? '取消全选' : '全选'}</button></div><div className="fw-space-grid">{spaces.map(space => { const id = String(space.id); const checked = form.spaceIds.includes(id); return <button key={id} className={checked ? 'selected' : ''} onClick={() => toggleSpace(id)}><span className="fw-check">{checked ? <Check size={13}/> : <Circle size={13}/>}</span><span><b>{space.name || `知识空间 ${id}`}</b><small>{space.description || space.visibility || id}</small></span></button>; })}</div></section>}
    <ErrorBanner error={error}/><div className="fw-actions"><span>{!spaces.length && <small>先执行发现，可自动列出知识空间</small>}</span><button className="fw-primary" disabled={busy === 'saving' || (!typedLinks.length && !form.spaceIds.length)} onClick={next}>{busy === 'saving' ? <LoaderCircle className="spin" size={16}/> : <ArrowRight size={16}/>}确认来源</button></div>
  </div>;
}
function ScopeStep({ form, setForm, settings, links, spaces, error, busy, back, save, sync }) {
  const selectedSourceCount = links.length + spaces.length;
  return <div className="fw-pane">
    <section className="fw-scope-summary">
      <div className="fw-section-title"><div><Network size={17}/><span><b>已选同步来源</b><small>共 {selectedSourceCount} 个来源，将统一进入本地知识库</small></span></div><em>{settings.sourceCount || selectedSourceCount} 个来源</em></div>
      <div className="fw-scope-sources">
        {links.map((item, index) => <div key={item.url + '-' + index}><TypePill type={item.type}/><span><b>{item.url}</b><small>飞书文档链接</small></span></div>)}
        {spaces.map(space => <div key={space.id}><TypePill type="wiki"/><span><b>{space.name || ('知识空间 ' + space.id)}</b><small>{space.description || String(space.id)}</small></span></div>)}
      </div>
    </section>
    <section className="fw-scope-card">
      <div className="fw-section-title"><div><RefreshCw size={17}/><span><b>同步范围</b><small>可递归读取 Wiki 页面中的关联文档</small></span></div></div>
      <label className="fw-switch-row"><span><b>递归同步关联文档</b><small>自动继续读取页面内可访问的 Wiki 和文档链接</small></span><input type="checkbox" checked={form.recursiveLinks} onChange={event => setForm(current => ({ ...current, recursiveLinks: event.target.checked }))}/><i/></label>
      <div className="fw-number-grid">
        <label><span>递归深度</span><input type="number" min="0" max="8" value={form.maxDepth} onChange={event => setForm(current => ({ ...current, maxDepth: Math.max(0, Math.min(8, Number(event.target.value) || 0)) }))}/><small>建议 2–4 层，深度越高同步时间越长</small></label>
        <label><span>文档上限</span><input type="number" min="1" max="2000" step="10" value={form.maxDocuments} onChange={event => setForm(current => ({ ...current, maxDocuments: Math.max(1, Math.min(2000, Number(event.target.value) || 1)) }))}/><small>防止首次同步读取过多内容</small></label>
      </div>
    </section>
    <ErrorBanner error={error}/>
    <div className="fw-actions"><button className="fw-secondary" onClick={back}><ArrowLeft size={15}/>上一步</button><span/><button className="fw-secondary" disabled={Boolean(busy)} onClick={save}>{busy === 'saving' ? <LoaderCircle className="spin" size={16}/> : <Save size={16}/>}保存设置</button><button className="fw-primary" disabled={Boolean(busy)} onClick={sync}>{busy === 'syncing' ? <LoaderCircle className="spin" size={16}/> : <RefreshCw size={16}/>}开始同步</button></div>
  </div>;
}

function ResultStep({ busy, progress, result, error, currentSync, retry, back, close }) {
  const warnings = warningList(result);
  const stats = result?.stats || currentSync?.stats || {};
  const complete = Boolean(result?.ok) && busy !== 'syncing';
  return <div className="fw-pane fw-result-pane">
    <section className={'fw-progress-card ' + (complete ? 'complete ' : '') + (error ? 'failed' : '')}>
      <div className="fw-progress-icon">{busy === 'syncing' ? <LoaderCircle className="spin" size={25}/> : error ? <AlertCircle size={25}/> : <CheckCircle2 size={25}/>}</div>
      <div className="fw-progress-copy"><span>{error ? '同步失败' : complete ? '同步完成' : '正在同步飞书内容'}</span><h3>{error ? errorText(error) : progress.label}</h3><div className="fw-progress-track"><i style={{ width: (error ? Math.max(progress.percent, 8) : progress.percent) + '%' }}/></div><small>{busy === 'syncing' ? progress.percent + '% · 正在读取与建立索引' : complete ? '内容已进入知识库，可继续问答和运行 Skill' : '等待开始同步'}</small></div>
    </section>
    {(result || currentSync) && <div className="fw-stats-grid">
      <section><b>{stats.discovered ?? result?.documents?.length ?? 0}</b><span>已发现</span></section>
      <section><b>{stats.imported ?? result?.documents?.length ?? 0}</b><span>已导入</span></section>
      <section><b>{stats.skipped ?? 0}</b><span>已跳过</span></section>
      <section><b>{warnings.length}</b><span>警告</span></section>
    </div>}
    {warnings.length > 0 && <section className="fw-warning-list"><div className="fw-section-title"><div><AlertCircle size={17}/><span><b>同步警告</b><small>以下内容已跳过，不影响已导入文档继续使用</small></span></div></div><div>{warnings.map(warning => <article key={warning.id}><AlertCircle size={15}/><span><b>{warning.message}</b><small>{[warning.type, warning.code, warning.url].filter(Boolean).join(' · ')}</small></span></article>)}</div></section>}
    {error && <ErrorBanner error={error}/>}
    <div className="fw-actions"><button className="fw-secondary" disabled={busy === 'syncing'} onClick={back}><ArrowLeft size={15}/>上一步</button><span/>{error && <button className="fw-secondary" onClick={retry}><RotateCcw size={15}/>重试</button>}<button className="fw-primary" disabled={busy === 'syncing'} onClick={complete ? close : retry}>{complete ? <Check size={16}/> : <RefreshCw size={16}/>} {complete ? '进入工作台' : '重新同步'}</button></div>
  </div>;
}

function TypePill({ type, count }) {
  const meta = TYPE_META[type] || TYPE_META.unknown; const Icon = meta.icon;
  return <span className={`fw-type ${meta.color}`}><Icon size={12}/>{meta.label}{count ? <b>{count}</b> : null}</span>;
}
