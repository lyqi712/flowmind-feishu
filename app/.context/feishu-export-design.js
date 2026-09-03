/**
 * 飞书输出功能设计
 * 
 * ## 核心能力
 * 1. 将 AI 回答/总结/方案输出到飞书文档
 * 2. 创建新文档或追加到现有文档
 * 3. 支持富文本格式（标题、列表、代码块）
 * 4. 自动同步到知识库
 * 
 * ## 技术架构
 * 
 * ### API 端点
 * - POST /api/feishu/export - 导出内容到飞书
 * - POST /api/feishu/append - 追加内容到现有文档
 * - GET /api/feishu/folders - 获取可用文件夹
 * 
 * ### 数据流
 * 1. 用户点击"输出到飞书"
 * 2. 选择目标位置（新文档/现有文档）
 * 3. 转换 Markdown → 飞书富文本
 * 4. 调用飞书 API 创建/更新文档
 * 5. 自动同步回本地知识库
 * 
 * ### 格式转换
 * - Markdown → 飞书 Block JSON
 * - 支持：标题、段落、列表、代码块、引用
 * - 保留原始 Markdown 作为备份
 * 
 * ## 用户体验
 * 
 * ### 输出操作
 * 1. 每条 AI 回答下方显示"输出到飞书"按钮
 * 2. 点击后弹出对话框：
 *    - 选择目标位置（文件夹/文档）
 *    - 预览格式化内容
 *    - 设置标题（新文档）
 * 3. 确认后后台执行，显示进度
 * 4. 完成后显示飞书文档链接
 * 
 * ### 同步反馈
 * - 实时显示：正在导出 → 已创建文档 → 正在同步 → 完成
 * - 错误处理：权限不足、网络错误、格式问题
 * 
 * ## 实现计划
 * 
 * ### Phase 1: 基础导出（40min）
 * - Markdown → 飞书 Block 转换器
 * - POST /api/feishu/export 端点
 * - 创建新文档到指定文件夹
 * 
 * ### Phase 2: UI 集成（30min）
 * - 回答下方"输出到飞书"按钮
 * - 导出对话框组件
 * - 进度反馈
 * 
 * ### Phase 3: 追加功能（20min）
 * - 追加到现有文档
 * - 文档选择器
 * 
 * ### Phase 4: 自动同步（20min）
 * - 导出后触发增量同步
 * - 更新本地知识库
 * 
 * ### Phase 5: 测试（10min）
 * - 单元测试
 * - 集成测试
 * 
 * ## 技术细节
 * 
 * ### 飞书 API
 * - 创建文档：POST /docx/v1/documents
 * - 追加内容：PATCH /docx/v1/documents/{document_id}/blocks/{block_id}/children
 * - Block 格式：https://open.feishu.cn/document/server-docs/docs/docs/docx-v1/document-block/block
 * 
 * ### Markdown 转换规则
 * ```javascript
 * {
 *   '# Title': { block_type: 1, heading1: { elements: [...] } },
 *   '## Title': { block_type: 2, heading2: { elements: [...] } },
 *   'paragraph': { block_type: 3, text: { elements: [...] } },
 *   '- item': { block_type: 4, bullet: { elements: [...] } },
 *   '```code```': { block_type: 13, code: { elements: [...] } }
 * }
 * ```
 * 
 * ### 状态管理
 * ```javascript
 * {
 *   exportStatus: 'idle' | 'exporting' | 'success' | 'error',
 *   exportedUrl: string | null,
 *   exportError: string | null
 * }
 * ```
 */

export const FEISHU_EXPORT_DESIGN = {
  version: '1.0.0',
  status: 'design-complete',
  estimatedTime: '2h'
};
