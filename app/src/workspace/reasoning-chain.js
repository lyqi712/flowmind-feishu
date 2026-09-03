export const DECISION_SUPPORT_SKILL_IDS = Object.freeze(['q2-planning', 'tech-selection', 'customer-proposal']);

export function skillIdOf(skill) {
  if (!skill) return '';
  return String(typeof skill === 'string' ? skill : skill.id || '').trim();
}

export function isDecisionSupportSkill(skill) {
  if (!skill) return false;
  if (skill.category === 'decision-support') return true;
  return DECISION_SUPPORT_SKILL_IDS.includes(skillIdOf(skill));
}

export function shouldShowReasoningChain(message) {
  if (!message || message.role === 'user') return false;
  if (!isDecisionSupportSkill(message.skill)) return false;
  return Array.isArray(message.reasoningSteps) && message.reasoningSteps.length > 0;
}

export function seedSkillReasoningSteps(skill = {}) {
  const titles = Array.isArray(skill.steps) && skill.steps.length
    ? skill.steps
    : ['理解任务', '检索材料', '生成方案'];
  return titles.map((title, index) => ({
    id: `step-${index + 1}`,
    step: index + 1,
    title: String(title),
    status: index === 0 ? 'in_progress' : 'pending',
    detail: ''
  }));
}

export function applySkillReasoningEvent(steps, event = {}, skill = {}) {
  const current = Array.isArray(steps) && steps.length ? steps.map(step => ({ ...step })) : seedSkillReasoningSteps(skill);
  const type = String(event?.type || '');

  if (type === 'start') return seedSkillReasoningSteps(skill);

  if (type === 'step') {
    const requested = Number(event.step);
    const index = Number.isFinite(requested) && requested > 0
      ? Math.min(requested - 1, current.length - 1)
      : Math.max(0, current.findIndex(step => step.status === 'in_progress' || step.status === 'pending'));
    return current.map((step, stepIndex) => {
      if (stepIndex < index) return { ...step, status: step.status === 'failed' ? 'failed' : 'completed' };
      if (stepIndex === index) {
        return {
          ...step,
          status: 'in_progress',
          title: event.name || event.label || event.title || step.title,
          detail: event.detail || event.status || step.detail
        };
      }
      return { ...step, status: step.status === 'completed' || step.status === 'failed' ? step.status : 'pending' };
    });
  }

  if (type === 'model' || type === 'model-delta') {
    const index = Math.max(0, current.findLastIndex?.(step => step.status === 'in_progress') ?? current.findIndex(step => step.status === 'in_progress'));
    const target = index >= 0 ? index : current.length - 1;
    return current.map((step, stepIndex) => stepIndex === target
      ? { ...step, status: 'in_progress', detail: event.model ? `正在调用 ${event.model}` : (step.detail || '正在综合判断') }
      : step);
  }

  if (type === 'artifact' || type === 'done') {
    return current.map(step => ({
      ...step,
      status: step.status === 'failed' ? 'failed' : 'completed',
      detail: step.detail || (type === 'done' ? '已生成可审阅方案' : step.detail)
    }));
  }

  if (type === 'error' || type === 'stopped') {
    const reason = event.error?.message || event.detail || (type === 'stopped' ? '已停止' : '本步失败');
    let marked = false;
    return current.map(step => {
      if (!marked && (step.status === 'in_progress' || step.status === 'pending')) {
        marked = true;
        return { ...step, status: type === 'stopped' ? 'cancelled' : 'failed', detail: reason };
      }
      return step;
    });
  }

  return current;
}

export function reasoningSummary(steps = []) {
  const list = Array.isArray(steps) ? steps : [];
  if (!list.length) return '';
  const failed = list.some(step => step.status === 'failed');
  const cancelled = list.some(step => step.status === 'cancelled');
  const completed = list.filter(step => step.status === 'completed').length;
  if (failed) return `推理中断 · ${completed}/${list.length} 步完成`;
  if (cancelled) return `已停止 · ${completed}/${list.length} 步完成`;
  if (completed === list.length) return `已完成 ${list.length} 步推理`;
  return `推理中 ${completed}/${list.length}`;
}
