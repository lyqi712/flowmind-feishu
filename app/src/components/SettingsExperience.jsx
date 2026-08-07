import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Bot,
  CheckCircle2,
  ChevronRight,
  Database,
  Download,
  FolderSync,
  HardDrive,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  Server,
  Settings,
  ShieldCheck,
  Upload,
  WifiOff
} from 'lucide-react';
import './SettingsExperience.css';

const SECTION_MODEL = 'model';
const SECTION_KNOWLEDGE = 'knowledge';
const SECTION_PRIVACY = 'privacy';

const SECTION_ITEMS = [
  { id: SECTION_MODEL, label: '模型与 Provider', description: '模型、中转站与鉴权', Icon: Bot },
  { id: SECTION_KNOWLEDGE, label: '知识库连接', description: '飞书与本地索引', Icon: Database },
  { id: SECTION_PRIVACY, label: '安全与隐私', description: '本地数据与备份', Icon: ShieldCheck }
];

function humanNumber(value) {
  return new Intl.NumberFormat('zh-CN').format(Number(value || 0));
}

function modelName(settings = {}) {
  return settings.defaultModel || settings.model || '未选择';
}

function providerName(provider = {}, settings = {}) {
  return provider.name || settings.providerName || settings.provider || '尚未选择 Provider';
}

function timeoutText(settings = {}) {
  const timeout = Number(settings.timeoutMs || 0);
  return timeout > 0 ? `${Math.round(timeout / 1000)}s` : '默认';
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error || '请求失败');
}

async function requestJson(fetcher, url, options) {
  const response = await fetcher(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.error?.message || body?.message || `请求失败（${response.status}）`);
  }
  return body;
}

export function SettingsSidebar({
  activeSection = SECTION_MODEL,
  onSectionChange,
  modelSettings = {},
  className = ''
}) {
  return (
    <aside className={`side-panel settings-experience-sidebar ${className}`.trim()} aria-label="设置导航">
      <div className="settings-experience-side-head">
        <div><span>应用配置</span><h2>设置</h2></div>
        <Settings size={18} aria-hidden="true" />
      </div>
      <nav className="settings-experience-nav" aria-label="设置分类">
        {SECTION_ITEMS.map(({ id, label, description, Icon }) => {
          const active = activeSection === id;
          const detail = id === SECTION_MODEL && modelSettings.configured
            ? `${modelName(modelSettings)} · 已连接`
            : description;
          return (
            <button
              type="button"
              key={id}
              className={active ? 'is-active' : ''}
              aria-current={active ? 'page' : undefined}
              data-settings-section={id}
              onClick={() => onSectionChange?.(id)}
            >
              <span className="settings-experience-nav-icon"><Icon size={18} aria-hidden="true" /></span>
              <span className="settings-experience-nav-copy"><b>{label}</b><small>{detail}</small></span>
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          );
        })}
      </nav>
      <div className="settings-experience-side-note">
        <LockKeyhole size={16} aria-hidden="true" />
        <span><b>本地优先</b><small>配置与知识数据保存在当前设备</small></span>
      </div>
    </aside>
  );
}

function ModelSettingsSection({ settings, provider, onManageModels }) {
  return (
    <div className="settings-experience-canvas" data-settings-panel={SECTION_MODEL}>
      <section className="settings-experience-heading">
        <span className="settings-experience-eyebrow">AI Infrastructure</span>
        <h1>模型与 Provider</h1>
        <p>统一管理官方 API、第三方中转站、本地 Ollama 与自定义 HTTP 服务。密钥只提交给本机服务端，界面不会回显明文。</p>
      </section>

      <section className="settings-experience-provider-card" aria-label="当前模型配置摘要">
        <div className="settings-experience-provider-logo"><Server size={26} aria-hidden="true" /></div>
        <div className="settings-experience-provider-main">
          <span className={`settings-experience-status ${settings.configured ? 'is-online' : ''}`}>
            <i />{settings.configured ? '已配置' : '等待配置'}
          </span>
          <h2>{providerName(provider, settings)}</h2>
          <p title={settings.baseUrl || ''}>{settings.baseUrl || '尚未设置 Base URL'}</p>
        </div>
        <div className="settings-experience-provider-facts">
          <span><small>默认模型</small><b>{modelName(settings)}</b></span>
          <span><small>超时</small><b>{timeoutText(settings)}</b></span>
          <span><small>API Key</small><b>{settings.hasApiKey ? '已安全保存' : provider.key ? '未配置' : '无需配置'}</b></span>
        </div>
        <button type="button" className="settings-experience-primary" onClick={() => onManageModels?.()}>
          <Settings size={16} aria-hidden="true" />管理模型
        </button>
      </section>

      <div className="settings-experience-feature-grid">
        <article><KeyRound size={21} aria-hidden="true" /><div><h3>密钥保护</h3><p>保存或测试后立即清空输入，不写入 LocalStorage，也不会通过设置接口返回。</p></div></article>
        <article><FolderSync size={21} aria-hidden="true" /><div><h3>中转站适配</h3><p>支持自定义 Base URL、鉴权 Header、模型列表以及请求和响应字段映射。</p></div></article>
        <article><CheckCircle2 size={21} aria-hidden="true" /><div><h3>连接诊断</h3><p>在模型管理中测试鉴权、模型可用性和请求延迟，再决定是否保存。</p></div></article>
      </div>
    </div>
  );
}

function Metric({ label, value, hint }) {
  return <div className="settings-experience-metric"><small>{label}</small><b>{humanNumber(value)}</b>{hint && <span>{hint}</span>}</div>;
}

function KnowledgeSettingsSection({ feishu, contentStatus, loading, error, onRefresh, onOpenFeishuWizard }) {
  const counts = contentStatus?.counts || {};
  const jobs = Array.isArray(contentStatus?.jobs) ? contentStatus.jobs : [];
  const activeJobs = jobs.filter(job => ['queued', 'running', 'processing'].includes(String(job.status || '').toLowerCase())).length;
  const sourceBreakdown = [
    ['文档链接', feishu?.documentUrls?.length || 0],
    ['知识空间', feishu?.spaceIds?.length || 0],
    ['文件夹', feishu?.folderTokens?.length || 0]
  ];

  return (
    <div className="settings-experience-canvas" data-settings-panel={SECTION_KNOWLEDGE}>
      <section className="settings-experience-heading settings-experience-heading-row">
        <div><span className="settings-experience-eyebrow">Knowledge Connections</span><h1>知识库连接</h1><p>在一个页面检查飞书授权、同步来源和本地索引状态；连接或补充来源时直接打开向导。</p></div>
        <button type="button" className="settings-experience-secondary" onClick={onRefresh} disabled={loading} aria-label="刷新飞书与索引状态">
          <RefreshCw size={16} className={loading ? 'is-spinning' : ''} aria-hidden="true" />{loading ? '刷新中' : '刷新状态'}
        </button>
      </section>

      {error && <div className="settings-experience-error" role="alert"><WifiOff size={18} aria-hidden="true" /><span><b>状态暂时不可用</b><small>{error}</small></span><button type="button" onClick={onRefresh}>重试</button></div>}

      <section className="settings-experience-connection-card" aria-busy={loading}>
        <div className="settings-experience-connection-top">
          <div className={`settings-experience-connection-mark ${feishu?.configured ? 'is-online' : ''}`}><Database size={24} aria-hidden="true" /></div>
          <div className="settings-experience-connection-title">
            <span className={`settings-experience-status ${feishu?.configured ? 'is-online' : ''}`}><i />{feishu?.configured ? '飞书连接可用' : feishu?.credentialsConfigured ? '已保存凭据，等待添加来源' : '尚未连接飞书'}</span>
            <h2>飞书知识来源</h2>
            <p>{feishu?.credentialsConfigured ? `应用标识 ${feishu.appIdMasked || '已脱敏'}` : '通过向导填写一次应用凭据，之后可直接粘贴文档、知识库或文件夹链接。'}</p>
          </div>
          <button type="button" className="settings-experience-primary" onClick={() => onOpenFeishuWizard?.()}>
            <FolderSync size={16} aria-hidden="true" />打开飞书连接向导
          </button>
        </div>
        <div className="settings-experience-source-breakdown" aria-label="飞书来源统计">
          {sourceBreakdown.map(([label, value]) => <span key={label}><small>{label}</small><b>{humanNumber(value)}</b></span>)}
          <span><small>来源合计</small><b>{humanNumber(feishu?.sourceCount)}</b></span>
        </div>
      </section>

      <section className="settings-experience-index-card">
        <div className="settings-experience-card-title"><div><span className="settings-experience-card-icon"><HardDrive size={19} aria-hidden="true" /></span><span><h2>本地知识索引</h2><p>同步后的内容会进入本机索引，用于搜索、问答与引用定位。</p></span></div><small>{contentStatus?.schema?.ready === false ? '需要维护' : '运行正常'}</small></div>
        <div className="settings-experience-metrics">
          <Metric label="知识内容" value={counts.content_items} hint="可阅读条目" />
          <Metric label="索引片段" value={counts.index_chunks} hint="可检索证据" />
          <Metric label="知识空间" value={counts.spaces} hint="已发现目录" />
          <Metric label="导入任务" value={counts.ingestion_jobs} hint={activeJobs ? `${activeJobs} 个处理中` : '当前无排队任务'} />
        </div>
      </section>
    </div>
  );
}

function PrivacySettingsSection({ backupBusy, restoreBusy, fileInputRef, onDownloadBackup, onChooseBackup, onRestoreBackup }) {
  return (
    <div className="settings-experience-canvas" data-settings-panel={SECTION_PRIVACY}>
      <section className="settings-experience-heading">
        <span className="settings-experience-eyebrow">Privacy & Portability</span>
        <h1>安全与隐私</h1>
        <p>清楚了解数据存放位置、密钥显示策略和迁移方式。备份只包含可迁移知识数据，不包含本地路径或明文凭据。</p>
      </section>

      <div className="settings-experience-privacy-grid">
        <article><span className="settings-experience-privacy-icon"><HardDrive size={22} aria-hidden="true" /></span><div><h2>本地存储</h2><p>知识内容、索引、笔记和工作产物保存在当前设备，由本机服务提供访问。</p><span className="settings-experience-policy"><CheckCircle2 size={14} />数据不依赖浏览器 LocalStorage</span></div></article>
        <article><span className="settings-experience-privacy-icon"><LockKeyhole size={22} aria-hidden="true" /></span><div><h2>密钥不回显</h2><p>飞书 Secret 与模型 API Key 保存后只显示配置状态，设置接口不会返回明文。</p><span className="settings-experience-policy"><CheckCircle2 size={14} />前端无法读取已保存密钥</span></div></article>
        <article><span className="settings-experience-privacy-icon"><Download size={22} aria-hidden="true" /></span><div><h2>可导出与恢复</h2><p>下载标准 JSON 备份，在新设备或新安装中以合并方式恢复知识内容。</p><span className="settings-experience-policy"><CheckCircle2 size={14} />备份自动清理路径与凭据字段</span></div></article>
      </div>

      <section className="settings-experience-backup-card">
        <div><span className="settings-experience-card-icon"><Database size={20} aria-hidden="true" /></span><span><h2>知识数据备份</h2><p>建议在升级、迁移设备或批量导入前先下载一份备份。</p></span></div>
        <div className="settings-experience-backup-actions">
          <button type="button" className="settings-experience-secondary" onClick={onDownloadBackup} disabled={backupBusy || restoreBusy}>
            {backupBusy ? <LoaderCircle size={16} className="is-spinning" /> : <Download size={16} />}{backupBusy ? '正在生成' : '下载 JSON 备份'}
          </button>
          <button type="button" className="settings-experience-primary" onClick={onChooseBackup} disabled={backupBusy || restoreBusy}>
            {restoreBusy ? <LoaderCircle size={16} className="is-spinning" /> : <Upload size={16} />}{restoreBusy ? '正在恢复' : '从 JSON 备份恢复'}
          </button>
          <input ref={fileInputRef} className="settings-experience-file-input" type="file" accept="application/json,.json" onChange={onRestoreBackup} aria-label="选择 FlowMind JSON 备份" />
        </div>
      </section>
      <p className="settings-experience-restore-note">恢复采用合并模式：已有内容按原标识更新，新内容追加；不会在未确认的情况下清空当前知识库。</p>
    </div>
  );
}

export function SettingsWorkspace({
  activeSection = SECTION_MODEL,
  modelSettings = {},
  provider = {},
  onManageModels,
  onOpenFeishuWizard,
  onToast,
  fetcher = globalThis.fetch,
  className = ''
}) {
  const [feishu, setFeishu] = useState(null);
  const [contentStatus, setContentStatus] = useState(null);
  const [knowledgeLoading, setKnowledgeLoading] = useState(false);
  const [knowledgeError, setKnowledgeError] = useState('');
  const [knowledgeInitialized, setKnowledgeInitialized] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const fileInputRef = useRef(null);
  const requestSequence = useRef(0);

  const refreshKnowledgeStatus = useCallback(async () => {
    const sequence = ++requestSequence.current;
    setKnowledgeLoading(true);
    setKnowledgeError('');
    try {
      const [nextFeishu, nextContentStatus] = await Promise.all([
        requestJson(fetcher, '/api/settings/feishu'),
        requestJson(fetcher, '/api/content/status')
      ]);
      if (sequence !== requestSequence.current) return;
      setFeishu(nextFeishu);
      setContentStatus(nextContentStatus);
    } catch (error) {
      if (sequence !== requestSequence.current) return;
      setKnowledgeError(errorMessage(error));
    } finally {
      if (sequence === requestSequence.current) {
        setKnowledgeInitialized(true);
        setKnowledgeLoading(false);
      }
    }
  }, [fetcher]);

  useEffect(() => {
    if (activeSection === SECTION_KNOWLEDGE && !knowledgeInitialized && !knowledgeLoading) {
      refreshKnowledgeStatus();
    }
  }, [activeSection, knowledgeInitialized, knowledgeLoading, refreshKnowledgeStatus]);

  const downloadBackup = useCallback(async () => {
    setBackupBusy(true);
    try {
      const response = await fetcher('/api/content/backup', { method: 'GET', headers: { accept: 'application/json' } });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.error?.message || `备份生成失败（${response.status}）`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'flowmind-content-backup.json';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      onToast?.('知识数据备份已下载');
    } catch (error) {
      onToast?.(errorMessage(error), 'error');
    } finally {
      setBackupBusy(false);
    }
  }, [fetcher, onToast]);

  const restoreBackup = useCallback(async (event) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    setRestoreBusy(true);
    try {
      const archive = JSON.parse(await file.text());
      if (!archive || archive.format !== 'flowmind-content-backup') {
        throw new Error('所选文件不是有效的 FlowMind JSON 备份');
      }
      const result = await requestJson(fetcher, '/api/content/backup/restore', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ archive, mode: 'merge' })
      });
      const restored = result.restored || {};
      onToast?.(`备份恢复成功：${humanNumber(restored.items)} 项内容、${humanNumber(restored.spaces)} 个空间、${humanNumber(restored.sources)} 个来源`);
      setFeishu(null);
      setContentStatus(null);
      setKnowledgeInitialized(false);
    } catch (error) {
      onToast?.(errorMessage(error), 'error');
    } finally {
      input.value = '';
      setRestoreBusy(false);
    }
  }, [fetcher, onToast]);

  return (
    <main className={`workspace settings-experience-workspace ${className}`.trim()}>
      <header className="settings-experience-workspace-head">
        <div><span className="settings-experience-app-icon"><Settings size={19} aria-hidden="true" /></span><span><strong>应用设置</strong><small>模型、知识来源与本地数据管理</small></span></div>
        <span className="settings-experience-current-section">{SECTION_ITEMS.find(item => item.id === activeSection)?.label || '应用设置'}</span>
      </header>

      {activeSection === SECTION_MODEL && <ModelSettingsSection settings={modelSettings} provider={provider} onManageModels={onManageModels} />}
      {activeSection === SECTION_KNOWLEDGE && <KnowledgeSettingsSection feishu={feishu} contentStatus={contentStatus} loading={knowledgeLoading} error={knowledgeError} onRefresh={refreshKnowledgeStatus} onOpenFeishuWizard={onOpenFeishuWizard} />}
      {activeSection === SECTION_PRIVACY && <PrivacySettingsSection backupBusy={backupBusy} restoreBusy={restoreBusy} fileInputRef={fileInputRef} onDownloadBackup={downloadBackup} onChooseBackup={() => fileInputRef.current?.click()} onRestoreBackup={restoreBackup} />}
    </main>
  );
}
