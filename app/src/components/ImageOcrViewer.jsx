import React, { useEffect, useMemo, useRef, useState } from 'react';

function numberOr(value, fallback = 0) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
function clamp(value, minimum = 0, maximum = 1) { return Math.min(maximum, Math.max(minimum, numberOr(value))); }
function suffixAnchor(value) { return String(value || '').match(/region:\d+/)?.[0] || ''; }
function sameAnchor(left, right) { return Boolean(left && right && (String(left) === String(right) || suffixAnchor(left) === suffixAnchor(right))); }
function normalizeRectangle(entry, imageWidth, imageHeight) {
  const source = entry?.region || entry?.bbox || entry || {};
  let x = numberOr(source.x ?? source.left ?? source.x0), y = numberOr(source.y ?? source.top ?? source.y0);
  let width = numberOr(source.width, numberOr(source.x1) - x), height = numberOr(source.height, numberOr(source.y1) - y);
  if ((x > 1 || width > 1) && imageWidth > 0) { x /= imageWidth; width /= imageWidth; }
  if ((y > 1 || height > 1) && imageHeight > 0) { y /= imageHeight; height /= imageHeight; }
  x = clamp(x); y = clamp(y); width = clamp(width, 0, 1 - x); height = clamp(height, 0, 1 - y);
  return width && height ? { x, y, width, height } : null;
}
function confidenceLabel(value) { return Number.isFinite(Number(value)) ? Math.round(Number(value)) + '%' : '\u2014'; }

export function ImageOcrViewer({ src, regions = [], content = '', activeAnchor, zoom = 100, width = 0, height = 0, confidence, onRegionClick }) {
  const [naturalSize, setNaturalSize] = useState({ width: Number(width) || 0, height: Number(height) || 0 });
  const [imageError, setImageError] = useState(false);
  const regionRefs = useRef(new Map());
  const normalized = useMemo(() => regions.map((entry, index) => {
    const anchor = String(entry.anchor || entry.pageAnchor || `page:${entry.pageNumber || 1}:region:${index + 1}`);
    return { ...entry, anchor, region: normalizeRectangle(entry, naturalSize.width || Number(width), naturalSize.height || Number(height)), text: String(entry.text || content.slice(Number(entry.startChar || 0), Number(entry.endChar || 0))).trim(), confidence: entry.confidence ?? confidence };
  }).filter(entry => entry.region), [regions, content, naturalSize, width, height, confidence]);

  useEffect(() => {
    if (!activeAnchor) return;
    const target = normalized.find(entry => sameAnchor(entry.anchor, activeAnchor));
    const node = target ? regionRefs.current.get(target.anchor) : null;
    node?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
  }, [activeAnchor, normalized]);
  useEffect(() => { setImageError(false); }, [src]);

  const baseWidth = naturalSize.width || Number(width) || 960, baseHeight = naturalSize.height || Number(height) || 640;
  const scaledWidth = Math.max(280, Math.round(baseWidth * zoom / 100)), scaledHeight = Math.max(180, Math.round(baseHeight * zoom / 100));

  return <div className="image-ocr-viewer" data-active-anchor={activeAnchor || ''}><div className="image-ocr-layout">
    <div className="image-ocr-canvas-scroll">{!imageError ? <div className="image-ocr-stage" style={{ width: scaledWidth, height: scaledHeight }}>
      <img src={src} alt={'OCR \u539f\u59cb\u56fe\u7247'} draggable="false" onError={() => setImageError(true)} onLoad={event => setNaturalSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}/>
      <div className="image-ocr-overlay" aria-label={'OCR \u6587\u5b57\u533a\u57df'}>{normalized.map((entry, index) => <button type="button" key={entry.anchor} ref={node => node ? regionRefs.current.set(entry.anchor, node) : regionRefs.current.delete(entry.anchor)} className={'image-ocr-region' + (sameAnchor(activeAnchor, entry.anchor) ? ' active' : '')} data-anchor={entry.anchor} style={{ left: `${entry.region.x * 100}%`, top: `${entry.region.y * 100}%`, width: `${entry.region.width * 100}%`, height: `${entry.region.height * 100}%` }} title={`${entry.text || 'OCR \u533a\u57df'} \u00b7 ${confidenceLabel(entry.confidence)}`} onClick={() => onRegionClick?.(entry.anchor, entry)}><span>{index + 1}</span></button>)}</div>
    </div> : <div className="image-ocr-error">{'\u56fe\u7247\u539f\u4ef6\u6682\u65f6\u4e0d\u53ef\u8bfb\u53d6\uff0c\u8bf7\u786e\u8ba4\u539f\u4ef6\u9644\u4ef6\u4ecd\u7136\u5b58\u5728\u3002'}</div>}</div>
    <aside className="image-ocr-regions" aria-label={'OCR \u533a\u57df\u5217\u8868'}><div className="image-ocr-regions-head"><b>{'\u8bc6\u522b\u533a\u57df'}</b><small>{'\u603b\u4f53\u7f6e\u4fe1\u5ea6 '}{confidenceLabel(confidence)}</small></div>{normalized.length ? <div className="image-ocr-region-list">{normalized.map((entry, index) => <button type="button" key={entry.anchor + '-list'} className={sameAnchor(activeAnchor, entry.anchor) ? 'active' : ''} onClick={() => onRegionClick?.(entry.anchor, entry)}><span><b>{'\u533a\u57df'} {index + 1}</b><em>{confidenceLabel(entry.confidence)}</em></span><small>{entry.text || '\u672a\u8bc6\u522b\u5230\u53ef\u5c55\u793a\u6587\u672c'}</small></button>)}</div> : <div className="image-ocr-empty">{'\u539f\u56fe\u5df2\u4fdd\u7559\uff0c\u4f46\u5f53\u524d\u6ca1\u6709\u53ef\u5b9a\u4f4d\u7684 OCR \u533a\u57df\u3002'}</div>}</aside>
  </div></div>;
}
