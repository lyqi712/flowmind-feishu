import React, { useEffect, useMemo, useRef, useState } from 'react';

function anchorFor(value, index) { return String(value || '').match(/time:[^:]+/)?.[0] || `time:${index}-${index + 1}`; }
function secondsFromAnchor(anchor) { const match = String(anchor || '').match(/^time:([\d.]+)-([\d.]+)/); return match ? Number(match[1]) : 0; }
function formatTimestamp(value) { const seconds = Math.max(0, Number(value) || 0); return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`; }
function confidenceLabel(value) { const numeric = Number(value); if (!Number.isFinite(numeric)) return ''; return `${Math.round(numeric <= 1 ? numeric * 100 : numeric)}%`; }

export function AudioTranscriptViewer({ src, segments = [], content = '', activeAnchor, onAnchorChange, durationMs = 0 }) {
  const audioRef = useRef(null);
  const rowRefs = useRef(new Map());
  const [currentTime, setCurrentTime] = useState(0);
  const normalized = useMemo(() => segments.map((entry, index) => ({
    ...entry,
    anchor: anchorFor(entry.anchor, index),
    text: String(content || '').slice(Number(entry.startChar || 0), Number(entry.endChar || 0)).trim(),
    timeStart: Number(entry.timeStart || 0),
    timeEnd: Number(entry.timeEnd || 0)
  })).filter(entry => entry.text), [segments, content]);
  const active = activeAnchor || normalized.find(entry => currentTime >= entry.timeStart && currentTime < entry.timeEnd)?.anchor;

  useEffect(() => {
    if (!active) return;
    const target = normalized.find(entry => entry.anchor === active);
    rowRefs.current.get(active)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    if (target && audioRef.current && Math.abs(audioRef.current.currentTime - target.timeStart) > 0.35) audioRef.current.currentTime = target.timeStart;
  }, [active, normalized]);
  function seek(anchor) {
    const seconds = secondsFromAnchor(anchor);
    if (audioRef.current) { audioRef.current.currentTime = seconds; void audioRef.current.play().catch(() => {}); }
    onAnchorChange?.(anchor);
  }
  return <div className="audio-transcript-viewer">
    <audio ref={audioRef} controls preload="metadata" src={src} onTimeUpdate={event => { const time = event.currentTarget.currentTime; setCurrentTime(time); const segment = normalized.find(entry => time >= entry.timeStart && time < entry.timeEnd); if (segment) onAnchorChange?.(segment.anchor); }} />
    <div className="audio-transcript-meta"><span>{normalized.length ? `${normalized.length} 个转写片段` : '暂无转写片段'}</span><span>{durationMs ? `${Math.round(durationMs / 1000)} 秒` : '时长由播放器读取'}</span></div>
    <div className="audio-segment-list">{normalized.map((entry, index) => <button type="button" key={`${entry.anchor}-${index}`} ref={node => node ? rowRefs.current.set(entry.anchor, node) : rowRefs.current.delete(entry.anchor)} className={active === entry.anchor ? 'active' : ''} onClick={() => seek(entry.anchor)}><span className="audio-segment-time">{formatTimestamp(entry.timeStart)}–{formatTimestamp(entry.timeEnd)}</span><span className="audio-segment-body">{entry.speaker && <b>{entry.speaker}</b>}<span>{entry.text}</span></span><span className="audio-segment-confidence">{confidenceLabel(entry.confidence)}</span></button>)}</div>
  </div>;
}
