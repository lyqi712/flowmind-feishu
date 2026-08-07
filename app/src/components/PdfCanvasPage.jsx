import React, { useEffect, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions, TextLayer } from 'pdfjs-dist/legacy/build/pdf.mjs';

GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url).toString();

export function PdfCanvasPage({ src, pageNumber, zoom = 100, annotations = [], onSelectionChange, onAnnotationClick }) {
  const canvasRef = useRef(null);
  const pageShellRef = useRef(null);
  const textLayerRef = useRef(null);
  const [state, setState] = useState({ status: 'loading', message: '' });
  const [pageSize, setPageSize] = useState({ width: 612, height: 792 });
  const [pdf, setPdf] = useState(null);

  useEffect(() => {
    let disposed = false;
    let loadingTask = null;
    async function load() {
      setState({ status: 'loading', message: '' });
      try {
        loadingTask = getDocument({ url: src });
        const loaded = await loadingTask.promise;
        if (disposed) { await loaded.destroy(); return; }
        setPdf(loaded);
        setState({ status: 'ready', message: '' });
      } catch (error) {
        if (!disposed) setState({ status: 'error', message: error?.message || '加载 PDF 原件失败' });
      }
    }
    load();
    return () => { disposed = true; loadingTask?.destroy?.(); setPdf(null); };
  }, [src]);

  useEffect(() => {
    if (!pdf || !canvasRef.current || !textLayerRef.current || !pageShellRef.current) return undefined;
    let disposed = false;
    let renderTask = null;
    let textLayer = null;
    async function render() {
      try {
        const page = await pdf.getPage(Number(pageNumber));
        const scale = Math.max(0.7, Number(zoom) / 100) * 1.25;
        const viewport = page.getViewport({ scale });
        if (disposed) return;
        const dpr = window.devicePixelRatio || 1;
        const canvas = canvasRef.current;
        canvas.width = Math.ceil(viewport.width * dpr);
        canvas.height = Math.ceil(viewport.height * dpr);
        canvas.style.width = viewport.width + 'px';
        canvas.style.height = viewport.height + 'px';
        pageShellRef.current.style.width = viewport.width + 'px';
        pageShellRef.current.style.height = viewport.height + 'px';
        setPageSize({ width: viewport.width, height: viewport.height });
        const context = canvas.getContext('2d', { alpha: false });
        renderTask = page.render({ canvasContext: context, viewport, transform: dpr === 1 ? null : [dpr, 0, 0, dpr, 0, 0] });
        await renderTask.promise;
        if (disposed) return;
        const textContent = await page.getTextContent();
        textLayerRef.current.replaceChildren();
        textLayer = new TextLayer({ textContentSource: textContent, container: textLayerRef.current, viewport });
        await textLayer.render();
        if (!disposed) setState({ status: 'ready', message: '' });
      } catch (error) {
        if (!disposed && error?.name !== 'RenderingCancelledException') setState({ status: 'error', message: error?.message || '加载 PDF 原件失败' });
      }
    }
    render();
    return () => { disposed = true; renderTask?.cancel?.(); textLayer?.cancel?.(); textLayerRef.current?.replaceChildren(); };
  }, [pdf, pageNumber, zoom]);

  function captureSelection() {
    const selection = window.getSelection?.();
    if (!selection || selection.isCollapsed || !selection.rangeCount || !pageShellRef.current?.contains(selection.anchorNode)) return;
    const range = selection.getRangeAt(0);
    const bounds = pageShellRef.current.getBoundingClientRect();
    const rects = [...range.getClientRects()].map((rect) => ({
      x: Math.max(0, Math.min(1, (rect.left - bounds.left) / bounds.width)),
      y: Math.max(0, Math.min(1, (rect.top - bounds.top) / bounds.height)),
      width: Math.max(0, Math.min(1, rect.width / bounds.width)),
      height: Math.max(0, Math.min(1, rect.height / bounds.height))
    })).filter((rect) => rect.width > 0 && rect.height > 0);
    const quote = selection.toString().trim();
    if (quote && rects.length) onSelectionChange?.({ pageNumber: Number(pageNumber), anchor: 'page:' + pageNumber + ':text', quote, selector: { rects, pageWidth: pageSize.width, pageHeight: pageSize.height } });
  }

  if (state.status === 'error') return <div className="pdf-canvas-error">PDF 原件渲染失败：{state.message}</div>;
  return <div className="pdf-canvas-view" onMouseUp={() => window.setTimeout(captureSelection, 0)}>
    {state.status === 'loading' && <div className="pdf-canvas-loading">正在加载 PDF 原件…</div>}
    <div ref={pageShellRef} className="pdf-page-shell" data-page-number={pageNumber} style={{ width: pageSize.width + 'px', height: pageSize.height + 'px' }}>
      <canvas ref={canvasRef} className="pdf-page-canvas" />
      <div ref={textLayerRef} className="pdf-text-layer" />
      <div className="pdf-annotation-overlay" aria-label={'第 ' + pageNumber + ' 页标注'}>
        {annotations.filter((annotation) => Number(annotation.pageNumber) === Number(pageNumber)).map((annotation) => (annotation.selector?.rects || []).map((rect, index) => <button key={annotation.id + '-' + index} type="button" className={'pdf-annotation-highlight color-' + (annotation.color || 'yellow')} style={{ left: (rect.x * 100) + '%', top: (rect.y * 100) + '%', width: (rect.width * 100) + '%', height: (rect.height * 100) + '%' }} title={annotation.comment || annotation.quote} onClick={() => onAnnotationClick?.(annotation)} />))}
      </div>
    </div>
  </div>;
}
