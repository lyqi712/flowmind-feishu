import React, { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import './CitationTooltip.css';

/**
 * 引用可视化组件 - 悬停预览引用内容
 *
 * @param {number} citationNumber - 引用编号 [1], [2], etc.
 * @param {object} evidence - 证据对象 { title, excerpt, document, anchor }
 * @param {function} onOpenDocument - 点击查看完整文档的回调
 */
export function CitationTooltip({ citationNumber, evidence, onOpenDocument }) {
  const [showPreview, setShowPreview] = useState(false);

  if (!evidence) {
    return <span className="citation-link broken">[{citationNumber}]</span>;
  }

  const handleClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!onOpenDocument || !evidence) return;
    onOpenDocument(evidence.document || evidence, evidence.anchor);
  };

  return (
    <span
      className="citation-link"
      data-citation={citationNumber}
      onMouseEnter={() => setShowPreview(true)}
      onMouseLeave={() => setShowPreview(false)}
      onClick={handleClick}
    >
      [{citationNumber}]

      {showPreview && (
        <div className="citation-preview">
          <div className="preview-header">
            <strong className="preview-title">{evidence.title || '文档'}</strong>
            {evidence.anchor && (
              <span className="preview-anchor">{evidence.anchor}</span>
            )}
          </div>

          <p className="preview-excerpt">
            {(evidence.excerpt || evidence.snippet || evidence.quote) ? String(evidence.excerpt || evidence.snippet || evidence.quote).slice(0, 200) : '暂无预览'}
            {String(evidence.excerpt || evidence.snippet || evidence.quote || '').length > 200 && '...'}
          </p>

          <div className="preview-footer">
            <button className="preview-action" onClick={handleClick}>
              <ExternalLink size={14} />
              查看完整文档
            </button>
            <span className="preview-hint">点击跳转</span>
          </div>
        </div>
      )}
    </span>
  );
}

/**
 * 在Markdown内容中解析并渲染引用
 *
 * @param {string} content - 包含 [1], [2] 等引用的文本
 * @param {array} evidences - 证据数组
 * @param {function} onOpenDocument - 打开文档回调
 */
export function renderContentWithCitations(content, evidences = [], onOpenDocument) {
  if (!content) return null;

  // 解析引用 [数字]
  const parts = [];
  let lastIndex = 0;
  const citationRegex = /\[(\d+)\]/g;
  let match;

  while ((match = citationRegex.exec(content)) !== null) {
    // 添加引用前的文本
    if (match.index > lastIndex) {
      parts.push({
        type: 'text',
        content: content.slice(lastIndex, match.index)
      });
    }

    // 添加引用
    const citationNumber = parseInt(match[1]);
    const evidence = evidences[citationNumber - 1]; // 索引从0开始

    parts.push({
      type: 'citation',
      number: citationNumber,
      evidence
    });

    lastIndex = match.index + match[0].length;
  }

  // 添加剩余文本
  if (lastIndex < content.length) {
    parts.push({
      type: 'text',
      content: content.slice(lastIndex)
    });
  }

  return (
    <>
      {parts.map((part, index) => {
        if (part.type === 'text') {
          return <span key={index}>{part.content}</span>;
        }
        return (
          <CitationTooltip
            key={index}
            citationNumber={part.number}
            evidence={part.evidence}
            onOpenDocument={onOpenDocument}
          />
        );
      })}
    </>
  );
}

export function injectCitationNodes(children, evidences = [], onOpenDocument) {
  function walk(node) {
    if (node == null || typeof node === 'boolean') return node;
    if (typeof node === 'string' || typeof node === 'number') {
      return renderContentWithCitations(String(node), evidences, onOpenDocument);
    }
    if (Array.isArray(node)) return node.map((child, index) => <React.Fragment key={index}>{walk(child)}</React.Fragment>);
    if (React.isValidElement(node)) {
      const type = node.type;
      if (type === 'code' || type === 'pre') return node;
      if (node.props?.children == null) return node;
      return React.cloneElement(node, { children: walk(node.props.children) });
    }
    return node;
  }
  return walk(children);
}

/**
 * 引用覆盖率可视化
 */
export function CitationCoverage({ coverage }) {
  if (!coverage) return null;

  const { percent, covered, total, uncoveredClaims = [] } = coverage;
  const isGood = percent >= 80;
  const isMedium = percent >= 50 && percent < 80;

  return (
    <div className={`citation-coverage ${isGood ? 'good' : isMedium ? 'medium' : 'low'}`}>
      <div className="coverage-bar">
        <div className="coverage-fill" style={{ width: `${percent}%` }} />
      </div>

      <div className="coverage-stats">
        <span className="coverage-percent">{percent}%</span>
        <span className="coverage-detail">{covered}/{total} 个关键结论有引用</span>
      </div>

      {uncoveredClaims.length > 0 && (
        <details className="coverage-details">
          <summary>未覆盖的结论 ({uncoveredClaims.length})</summary>
          <ul>
            {uncoveredClaims.map((claim, i) => (
              <li key={i}>{claim}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
