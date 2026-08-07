import React from 'react';
import { Plus } from 'lucide-react';

export async function request(path, options) {
  const response = await fetch(path, options);
  const text = await response.text();
  let data = {};
  if (text) try { data = JSON.parse(text); } catch { data = { message: text }; }
  if (!response.ok) throw new Error(data?.error?.message || data?.message || `HTTP ${response.status}`);
  return data;
}
export const jsonOptions = (method, body) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export async function downloadExport(payload, onToast) {
  const response = await fetch('/api/exports/render', jsonOptions('POST', payload));
  if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data?.error?.message || `导出失败（HTTP ${response.status}）`); }
  const disposition = response.headers.get('content-disposition') || '';
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const fileName = encoded ? decodeURIComponent(encoded) : `FlowMind-export.${payload.format === 'html' ? 'html' : 'md'}`;
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a'); link.href = url; link.download = fileName; document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000); onToast?.(`已导出：${fileName}`); return fileName;
}
export const formatTime = value => value ? new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : '';

export function ModuleWelcome({ icon: Icon, title, description, action, actionLabel }) {
  return <div className="module-welcome"><span><Icon size={30}/></span><h2>{title}</h2><p>{description}</p><button onClick={action}><Plus size={16}/>{actionLabel}</button></div>;
}
