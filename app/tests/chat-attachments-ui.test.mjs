import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

test('聊天附件具备真实文件输入、粘贴截图和拖拽入口', () => {
  assert.match(source, /type="file" multiple/);
  assert.match(source, /onPaste=\{handlePaste\}/);
  assert.match(source, /onDrop=\{handleDrop\}/);
  assert.match(source, /onAddAttachments\(files\)/);
});

test('聊天附件上传使用临时附件 API 并将 temporaryId 带入问答请求', () => {
  assert.match(source, /fetch\('\/api\/chat\/attachments'/);
  assert.match(source, /'x-file-name': encodeURIComponent\(record\.fileName\)/);
  assert.match(source, /attachments: activeAttachments\.map\(item => \(\{ temporaryId: item\.temporaryId \}\)\)/);
  assert.match(source, /fetch\(`\/api\/chat\/attachments\/\$\{encodeURIComponent\(item\.temporaryId\)\}`/);
});

test('附件状态、重试、移除与当前会话清理均有可见操作', () => {
  assert.match(source, /status: 'uploading'/);
  assert.match(source, /status: 'error'/);
  assert.match(source, /onRetryAttachment\(item\)/);
  assert.match(source, /onRemoveAttachment\(item\)/);
  assert.match(source, /void clearChatAttachments\(\)/);
  assert.match(source, /onRemoveAttachment\(item\)/);
});

test('截图引用可回到本地图片并显示 region 定位框', () => {
  assert.match(source, /citationDocumentId === citation\.documentId/);
  assert.match(source, /attachment-image-stage/);
  assert.match(source, /citation-region/);
  assert.match(source, /const region = preview\?\.citation\?\.region/);
});

test('附件工作区具备紧凑响应式样式和处理中反馈', () => {
  assert.match(css, /\.attachment-tray/);
  assert.match(css, /\.attachment-preview-backdrop/);
  assert.match(css, /\.citation-region/);
  assert.match(css, /@media\(max-width:680px\)/);
});



test('附件预校验使用后端 capabilities 的数量、单文件和总大小限制', () => {
  assert.match(source, /limits\.maxCount/);
  assert.match(source, /limits\.maxFileBytes/);
  assert.match(source, /limits\.maxTotalBytes/);
  assert.match(source, /acceptedExtensions = new Set/);
  assert.match(source, /本轮附件总大小超过/);
});

test('新会话和移除操作隔离旧上传批次并回收服务端临时件', () => {
  assert.match(source, /chatAttachmentGenerationRef/);
  assert.match(source, /chatAttachmentBatchRef/);
  assert.match(source, /isCurrentSession/);
  assert.match(source, /isStillAttached/);
  assert.match(source, /deleteTemporaryChatAttachment\(data\.temporaryId\)/);
});


test('附件默认仅检索当前附件，并允许显式切换为附件 + 全库', () => {
  assert.match(source, /chatIncludeKnowledgeBase/);
  assert.match(source, /includeKnowledgeBase: activeAttachments.length \? chatIncludeKnowledgeBase : true/);
  assert.match(source, /className="attachment-scope-toggle"/);
  assert.match(source, /aria-pressed=\{includeKnowledgeBase\}/);
  assert.match(css, /\.attachment-scope-toggle/);
});

test('模型抽屉与附件预览遵循 dialog、Escape 和焦点回归协议', () => {
  for (const fragment of ['function useModalFocus', 'initialFocusRef', 'focusableDialogElements', 'role="dialog"', 'aria-modal="true"', 'attachment-preview-title', 'model-drawer-title', 'useModalFocus(Boolean(preview)', 'useModalFocus(true, dialogRef, close)', 'useModalFocus(open, sheetRef, onClose, searchRef)', 'ref={sheetRef}']) {
    assert.ok(source.includes(fragment), `missing ${fragment}`);
  }
  assert.match(source, /event\.key === 'Escape'/);
});
