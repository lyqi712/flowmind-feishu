export function createFakeModelService({
  answer = '根据已提供资料，结论如下 [1]。',
  skillContent = '这份材料围绕提示词、智能体和模板展开。先交代适用场景，再列出可复用结构，最后说明如何把行业信息交给模型执行，并保留可回查的引用编号 [1]。'
} = {}) {
  const seen = [];
  const resolveAnswer = (options = {}) => typeof answer === 'function'
    ? answer(options.messages || options.history || [])
    : answer;
  return {
    ready: Promise.resolve(),
    seen,
    async publicSettings() {
      return { provider: 'test-provider', model: 'fake-model', fallbackToLocal: false, configured: true };
    },
    async *answer(options = {}) {
      seen.push(options);
      yield resolveAnswer(options);
    },
    async *streamGenerate(options = {}) {
      seen.push(options);
      // Skill 工作流通过 system+prompt 调用；chat/agent 通过 messages 调用。
      if (options.prompt && !Array.isArray(options.messages)) { yield skillContent; return; }
      yield resolveAnswer(options);
    },
    async generate(options = {}) {
      seen.push(options);
      if (options.prompt && !Array.isArray(options.messages)) return skillContent;
      return resolveAnswer(options);
    }
  };
}
