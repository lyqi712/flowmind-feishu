// HTTP success must describe usable content, not only a completed loop.
export function ingestionHttpResult(result, { graph, publicItem = item => item } = {}) {
  const status = result.job?.status;
  const succeeded = ['created', 'versioned', 'unchanged', 'restored', 'duplicates'].reduce((sum, key) => sum + Number(result.stats?.[key] || 0), 0);
  const failed = Math.max(0, Number(result.stats?.failed || 0));
  const partial = status === 'partial' || (succeeded > 0 && failed > 0);
  const ok = status === 'completed' && failed === 0 && succeeded > 0;
  const body = {
    ok, partial, succeeded, failed,
    job: result.job, stats: result.stats, warnings: result.warnings || [],
    ...(graph ? { graph: graph.stats || graph } : {}),
    items: (result.results || []).map(entry => ({ index: entry.index, action: entry.action, item: publicItem(entry.item) }))
  };
  if (!ok) {
    body.error = {
      code: partial ? 'CONTENT_IMPORT_PARTIAL' : result.warnings?.[0]?.code || 'CONTENT_IMPORT_FAILED',
      message: partial ? `已导入 ${succeeded} 项，${failed} 项失败。请查看失败详情后重试。` : result.warnings?.[0]?.message || '未导入可用内容，请检查文件后重试。'
    };
  }
  return { status: ok ? 201 : partial ? 207 : 422, body };
}
