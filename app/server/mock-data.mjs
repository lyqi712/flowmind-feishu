const generatedAt = '2026-08-03T00:00:00.000Z';

export const MOCK_DOCUMENTS = Object.freeze([
  {
    id: 'mock-product-overview',
    nodeToken: 'mock_product_overview',
    title: '知识库助手产品说明',
    content: '知识库助手用于连接飞书知识空间，将分散的团队文档统一同步到本地索引。核心能力包括增量同步、自然语言检索问答、可追溯引用、会话保存和 Skill 工作流。回答必须展示来源，帮助用户回到原文核验。',
    source: 'mock',
    url: 'mock://wiki/product-overview',
    updatedAt: generatedAt
  },
  {
    id: 'mock-sync-guide',
    nodeToken: 'mock_sync_guide',
    title: '飞书知识库同步指南',
    content: '真实飞书同步需要配置应用 ID、应用密钥和知识空间 ID。服务端先申请 tenant access token，再遍历 wiki v2 的空间节点；遇到 docx 节点时读取 raw content。同步结果写入本地 JSON 状态，失败时默认保留原有文档。只有请求明确允许时才回退到 Mock 数据。',
    source: 'mock',
    url: 'mock://wiki/sync-guide',
    updatedAt: generatedAt
  },
  {
    id: 'mock-retrieval',
    nodeToken: 'mock_retrieval',
    title: '本地检索与引用规范',
    content: '本地检索同时计算标题命中、正文词项命中和短语命中。答案从得分最高的文档中抽取相关句子，并给出编号引用、文档标题、摘要和定位链接。没有相关材料时应明确提示先同步或换一个问题，不能编造知识库中不存在的事实。',
    source: 'mock',
    url: 'mock://wiki/retrieval',
    updatedAt: generatedAt
  },
  {
    id: 'mock-skills',
    nodeToken: 'mock_skills',
    title: 'Skill 工作流设计',
    content: '总结 Skill 负责提炼单篇或多篇文档的主题、要点和行动项。对比 Skill 负责识别多份材料的共同点、差异和适用场景。研究报告 Skill 先检索证据，再组织执行摘要、关键发现、风险限制、建议和引用。每个 Skill 都以流式步骤展示执行过程并保存产物。',
    source: 'mock',
    url: 'mock://wiki/skills',
    updatedAt: generatedAt
  },
  {
    id: 'mock-security',
    nodeToken: 'mock_security',
    title: '连接器安全与错误处理',
    content: '飞书应用凭据只从服务端环境变量读取，不写入状态文件，也不返回给浏览器。上游错误转换成阶段、状态码和可读消息，日志和响应都不包含请求头、应用密钥或 tenant token。Mock 回退由每次同步请求的参数控制。',
    source: 'mock',
    url: 'mock://wiki/security',
    updatedAt: generatedAt
  }
]);

export function getMockSyncResult() {
  return {
    source: 'mock',
    space: { id: 'mock-space', name: '飞书知识库（Mock）' },
    documents: structuredClone(MOCK_DOCUMENTS),
    cursor: `mock:${MOCK_DOCUMENTS.length}`,
    stats: { discovered: MOCK_DOCUMENTS.length, imported: MOCK_DOCUMENTS.length, skipped: 0 }
  };
}
