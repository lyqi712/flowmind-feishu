import React, { useEffect, useState } from 'react';

function titleFromContent(content = '', fallback = '') {
  const text = String(content || '').replace(/\r/g, '');
  const heading = text.match(/^#{1,3}\s+(.+)$/m);
  if (heading?.[1]) return heading[1].trim().slice(0, 80);
  const line = text.split('\n').map(item => item.trim()).find(Boolean);
  if (line) return line.replace(/^#+\s*/, '').slice(0, 80);
  return String(fallback || '').trim().slice(0, 80);
}

export function FeishuExportDialog({ content = '', defaultTitle = '', onClose, onExport, onOpenDocument, onConnect }) {
  const [title, setTitle] = useState(() => titleFromContent(content, defaultTitle));
  const [folderId, setFolderId] = useState('');
  const [folders, setFolders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [hint, setHint] = useState('');
  const [configured, setConfigured] = useState(true);
  const [canExport, setCanExport] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch('/api/feishu/folders')
      .then(res => res.json())
      .then(data => {
        if (cancelled) return;
        const nextFolders = Array.isArray(data.folders) ? data.folders : [];
        setFolders(nextFolders);
        setConfigured(data.configured !== false);
        setCanExport(data.canExport !== false);
        setHint(data.hint || '');
        const preferred = data.defaultFolderId || nextFolders.find(item => item.default)?.id || '';
        if (preferred) setFolderId(preferred);
        if (!data.ok && data.error?.message) setError(data.error.message);
      })
      .catch(() => {
        if (!cancelled) {
          setError('网络错误');
          setHint('暂时读不到飞书文件夹。检查网络后重试，或先去设置里确认飞书连接。');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const handleExport = async () => {
    if (!title.trim()) {
      setError('请输入文档标题');
      return;
    }
    if (!canExport) {
      setError(configured ? '当前连接还不能创建飞书文档' : '还没连接飞书，先完成应用授权');
      return;
    }
    setExporting(true);
    setError(null);
    try {
      const res = await fetch('/api/feishu/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, title: title.trim(), folderId })
      });
      const data = await res.json();
      if (data.ok) {
        const document = {
          ...data.document,
          folderName: data.document?.folderName || folders.find(item => item.id === folderId)?.name || ''
        };
        setSuccess(document);
        onExport?.(document);
      } else {
        setError(data.error?.message || '导出失败');
      }
    } catch {
      setError('网络错误');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content feishu-export-dialog" onClick={event => event.stopPropagation()}>
        <div className="modal-header">
          <h2>导出到飞书</h2>
          <button type="button" className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          {success ? (
            <div className="export-success">
              <div className="success-icon">✓</div>
              <h3>导出成功</h3>
              <p>已放到「{success.folderName || '飞书云空间'}」，并收回知识库。没有改原来的资料。</p>
              {success.contentItemId && (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    onOpenDocument?.({ id: success.contentItemId, documentId: success.contentItemId });
                    onClose();
                  }}
                >
                  打开这篇
                </button>
              )}
              {success.url && (
                <a href={success.url} target="_blank" rel="noopener noreferrer" className={success.contentItemId ? 'btn btn-secondary' : 'btn btn-primary'}>
                  在飞书打开
                </a>
              )}
            </div>
          ) : (
            <>
              <div className="form-group">
                <label>文档标题 *</label>
                <input
                  type="text"
                  value={title}
                  onChange={event => setTitle(event.target.value)}
                  placeholder="输入文档标题"
                  disabled={exporting}
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label>目标文件夹（可选）</label>
                {loading ? (
                  <div className="loading-folders">正在读取飞书文件夹…</div>
                ) : folders.length > 0 ? (
                  <select value={folderId} onChange={event => setFolderId(event.target.value)} disabled={exporting}>
                    <option value="">飞书云空间默认位置</option>
                    {folders.map(folder => (
                      <option key={folder.id} value={folder.id}>{folder.name}</option>
                    ))}
                  </select>
                ) : (
                  <div className={`no-folders ${configured ? '' : 'is-blocked'}`}>
                    {hint || '暂无可用文件夹，仍可导出到默认位置'}
                    {!configured && onConnect ? (
                      <button type="button" className="folder-connect" onClick={onConnect}>去连接飞书</button>
                    ) : null}
                  </div>
                )}
              </div>
              <div className="content-preview">
                <label>内容预览</label>
                <div className="preview-box">
                  {String(content || '').slice(0, 500)}
                  {String(content || '').length > 500 ? '...' : ''}
                </div>
              </div>
              {error && <div className="error-message">{error}</div>}
            </>
          )}
        </div>
        {!success && (
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={exporting}>取消</button>
            <button type="button" className="btn btn-primary" onClick={handleExport} disabled={exporting || !title.trim() || !canExport}>
              {exporting ? '导出中...' : folders.length ? '确认导出' : '导出到默认位置'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
