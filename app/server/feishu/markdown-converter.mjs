/**
 * Markdown 转飞书富文本 Block 转换器
 */

/**
 * 将 Markdown 文本转换为飞书文档 Block 结构
 * @param {string} markdown - Markdown 文本
 * @returns {Array} 飞书 Block 数组
 */
export function markdownToFeishuBlocks(markdown) {
  const lines = markdown.split('\n');
  const blocks = [];
  let i = 0;
  
  while (i < lines.length) {
    const line = lines[i];
    
    // 空行
    if (!line.trim()) {
      i++;
      continue;
    }
    
    // 一级标题
    if (line.startsWith('# ')) {
      blocks.push(createHeadingBlock(1, line.slice(2).trim()));
      i++;
      continue;
    }
    
    // 二级标题
    if (line.startsWith('## ')) {
      blocks.push(createHeadingBlock(2, line.slice(3).trim()));
      i++;
      continue;
    }
    
    // 三级标题
    if (line.startsWith('### ')) {
      blocks.push(createHeadingBlock(3, line.slice(4).trim()));
      i++;
      continue;
    }
    
    // 代码块
    if (line.startsWith('```')) {
      const codeLines = [];
      const lang = line.slice(3).trim() || 'text';
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      blocks.push(createCodeBlock(codeLines.join('\n'), lang));
      i++; // 跳过结束的 ```
      continue;
    }
    
    // 无序列表
    if (line.match(/^[\-\*]\s/)) {
      blocks.push(createBulletBlock(line.replace(/^[\-\*]\s/, '').trim()));
      i++;
      continue;
    }
    
    // 有序列表
    if (line.match(/^\d+\.\s/)) {
      blocks.push(createNumberedBlock(line.replace(/^\d+\.\s/, '').trim()));
      i++;
      continue;
    }
    
    // 引用块
    if (line.startsWith('> ')) {
      blocks.push(createQuoteBlock(line.slice(2).trim()));
      i++;
      continue;
    }
    
    // 普通段落
    blocks.push(createTextBlock(line.trim()));
    i++;
  }
  
  return blocks;
}

/**
 * 创建标题 Block
 */
function createHeadingBlock(level, text) {
  const blockTypes = { 1: 3, 2: 4, 3: 5 }; // heading1=3, heading2=4, heading3=5
  const styleMap = { 1: 'heading1', 2: 'heading2', 3: 'heading3' };
  
  return {
    block_type: blockTypes[level],
    [styleMap[level]]: {
      elements: [{ text_run: { content: text } }]
    }
  };
}

/**
 * 创建文本段落 Block
 */
function createTextBlock(text) {
  // 处理行内格式：**粗体**、*斜体*、`代码`
  const elements = parseInlineFormats(text);
  
  return {
    block_type: 2, // text
    text: { elements }
  };
}

/**
 * 创建无序列表 Block
 */
function createBulletBlock(text) {
  return {
    block_type: 12, // bullet
    bullet: {
      elements: [{ text_run: { content: text } }]
    }
  };
}

/**
 * 创建有序列表 Block
 */
function createNumberedBlock(text) {
  return {
    block_type: 13, // ordered
    ordered: {
      elements: [{ text_run: { content: text } }]
    }
  };
}

/**
 * 创建代码块 Block
 */
function createCodeBlock(code, language) {
  return {
    block_type: 14, // code
    code: {
      language: language === 'text' ? 1 : getLanguageId(language),
      elements: [{ text_run: { content: code } }]
    }
  };
}

/**
 * 创建引用块 Block
 */
function createQuoteBlock(text) {
  return {
    block_type: 15, // quote
    quote: {
      elements: [{ text_run: { content: text } }]
    }
  };
}

/**
 * 解析行内格式
 */
function parseInlineFormats(text) {
  const elements = [];
  let remaining = text;
  
  // 简化实现：暂时不处理行内格式，直接返回纯文本
  // 完整实现需要解析 **bold**、*italic*、`code` 等
  return [{ text_run: { content: text } }];
}

/**
 * 获取语言 ID
 */
function getLanguageId(lang) {
  const langMap = {
    javascript: 19,
    typescript: 20,
    python: 23,
    java: 17,
    go: 14,
    rust: 25,
    sql: 26,
    html: 15,
    css: 7,
    json: 18,
    markdown: 21,
    bash: 3,
    shell: 3,
    text: 1
  };
  return langMap[lang.toLowerCase()] || 1;
}

/**
 * 将飞书 Block 数组转换为创建文档的请求体
 */
export function createFeishuDocumentBody(title, blocks) {
  return {
    title: {
      elements: [{ text_run: { content: title } }]
    },
    blocks
  };
}
