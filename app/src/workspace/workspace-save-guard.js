const guards = new Set();

export function registerWorkspaceSaveGuard(guard) {
  guards.add(guard);
  return () => guards.delete(guard);
}

export async function runAfterWorkspaceSave(action) {
  for (const guard of [...guards]) {
    const result = await guard();
    if (result?.ok === false) return { ok: false, error: result.error || '保存尚未完成，已保留当前编辑。' };
  }
  return { ok: true, result: await action() };
}
