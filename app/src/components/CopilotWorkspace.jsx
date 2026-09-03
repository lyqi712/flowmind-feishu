import React, { useEffect, useState } from 'react';
import { Bot, Check, ChevronRight, LibraryBig, LoaderCircle, MemoryStick, MessageSquareText, Plus, Save, Sparkles, Trash2, Workflow } from 'lucide-react';
import './WorkspaceModules.css';
import { jsonOptions, ModuleWelcome, request } from './WorkspaceModuleShared.jsx';

const DEMO_SKILL_IDS = new Set(['q2-planning', 'tech-selection', 'customer-proposal']);

function startersText(prompts = []) {
  return (Array.isArray(prompts) ? prompts : []).map(item => {
    const prompt = String(item?.prompt || item?.label || '').trim();
    const label = String(item?.label || '').trim();
    if (!prompt) return '';
    return label && label !== prompt ? `${label}|${prompt}` : prompt;
  }).filter(Boolean).join('\n');
}

function formFromCopilot(item) {
  if (!item) return null;
  return {
    ...item,
    userPrompt: item.userPrompt ?? item.systemPrompt ?? '',
    memoriesText: (item.memories || []).join('\n'),
    startersText: startersText(item.starterPrompts),
    knowledgeBaseIds: Array.isArray(item.knowledgeBaseIds) ? item.knowledgeBaseIds : []
  };
}

export function CopilotModule({ skills = [], knowledgeBases = [], onToast, onUseInChat }) {
  const [copilots, setCopilots] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState('loading');
  async function load(preferred) {
    setBusy('loading');
    try {
      const data = await request('/api/copilots');
      setCopilots(data.copilots);
      setActiveId(data.activeCopilotId);
      const next = data.copilots.find(item => item.id === (preferred || selectedId)) || data.copilots[0] || null;
      setSelectedId(next?.id || null);
      setForm(formFromCopilot(next));
    } catch (error) {
      onToast?.(error.message, 'error');
    } finally {
      setBusy('');
    }
  }
  useEffect(() => { load(); }, []);
  function select(item) {
    setSelectedId(item.id);
    setForm(formFromCopilot(item));
  }
  async function createCopilot() {
    setBusy('create');
    try {
      const data = await request('/api/copilots', jsonOptions('POST', {
        name: '新 Copilot',
        avatar: '🤖',
        userPrompt: '基于已连接知识像同事一样自然、准确地回答；该引用时用 [1] [2]，不要套固定模板。',
        skillIds: [],
        starterPrompts: [],
        activate: true
      }));
      await load(data.copilot.id);
      onToast?.('已创建并激活 Copilot');
    } catch (error) {
      onToast?.(error.message, 'error');
    } finally {
      setBusy('');
    }
  }
  async function save(activate = false, { useInChat = false } = {}) {
    if (!form?.id) return;
    setBusy(useInChat ? 'use' : 'save');
    try {
      const memories = String(form.memoriesText || '').split(/\n+/).map(item => item.trim()).filter(Boolean);
      const data = await request(`/api/copilots/${form.id}`, jsonOptions('PATCH', {
        name: form.name,
        avatar: form.avatar,
        userPrompt: form.userPrompt,
        skillIds: form.skillIds || [],
        knowledgeBaseIds: form.knowledgeBaseIds || [],
        starterPrompts: form.startersText,
        memoryEnabled: form.memoryEnabled !== false,
        memories,
        activate: activate || useInChat
      }));
      const next = formFromCopilot(data.copilot);
      setForm(next);
      setCopilots(current => current.map(item => item.id === data.copilot.id ? data.copilot : item));
      if (activate || useInChat) setActiveId(data.copilot.id);
      onToast?.(useInChat ? '已用这个 Copilot 开始问答' : activate ? 'Copilot 已保存并激活' : 'Copilot 已保存');
      if (useInChat) onUseInChat?.(data.copilot);
    } catch (error) {
      onToast?.(error.message, 'error');
    } finally {
      setBusy('');
    }
  }
  async function remove() {
    if (!form?.id) return;
    try {
      await request(`/api/copilots/${form.id}`, { method: 'DELETE' });
      await load();
      onToast?.('Copilot 已删除');
    } catch (error) {
      onToast?.(error.message, 'error');
    }
  }
  function toggleSkill(id) {
    setForm(current => ({ ...current, skillIds: (current.skillIds || []).includes(id) ? current.skillIds.filter(item => item !== id) : [...(current.skillIds || []), id] }));
  }
  function toggleKnowledgeBase(id) {
    setForm(current => ({ ...current, knowledgeBaseIds: (current.knowledgeBaseIds || []).includes(id) ? current.knowledgeBaseIds.filter(item => item !== id) : [...(current.knowledgeBaseIds || []), id] }));
  }
  return <>
    <aside className="side-panel module-side">
      <div className="side-head"><div><span>Personal Agents</span><h2>我的 Copilot</h2></div><button type="button" aria-label="新建 Copilot" onClick={createCopilot}><Plus size={17}/></button></div>
      <div className="module-list padded">{busy === 'loading' ? <div className="module-empty"><LoaderCircle className="spin"/>读取 Copilot…</div> : copilots.map(item => <button key={item.id} className={selectedId === item.id ? 'active' : ''} onClick={() => select(item)}><span className="copilot-avatar">{item.avatar || '🤖'}</span><span><b>{item.name}</b><small>{item.id === activeId ? '当前激活' : `${item.skillIds?.length || 0} 个 Skill`}</small></span>{item.id === activeId ? <Check size={14}/> : <ChevronRight size={14}/>}</button>)}</div>
    </aside>
    <main className="workspace module-workspace">{form ? <>
      <header className="workspace-head">
        <div className="workspace-title"><span className="ai-avatar"><Bot size={19}/></span><div><strong>Copilot 配置</strong><small>{form.id === activeId ? '当前问答默认使用' : '独立指令、知识范围、开场问题和 Skill'}</small></div></div>
        <div className="head-actions">
          <button type="button" onClick={() => save(false)}><Save size={16}/>保存</button>
          <button className="primary-inline" type="button" onClick={() => save(true)}><Sparkles size={16}/>保存并激活</button>
          {onUseInChat ? <button type="button" onClick={() => save(true, { useInChat: true })}><MessageSquareText size={16}/>用这个问答</button> : null}
          <button type="button" className="danger-lite" aria-label="删除 Copilot" onClick={remove}><Trash2 size={16}/></button>
        </div>
      </header>
      <div className="copilot-canvas">
        <section className="copilot-form">
          <div className="avatar-name">
            <input value={form.avatar || ''} onChange={event => setForm(current => ({ ...current, avatar: event.target.value }))}/>
            <input value={form.name || ''} onChange={event => setForm(current => ({ ...current, name: event.target.value }))}/>
          </div>
          <label>
            <span>用户自定义指令</span>
            <textarea
              className="user-prompt-input"
              value={form.userPrompt || ''}
              onChange={event => setForm(current => ({ ...current, userPrompt: event.target.value }))}
              placeholder="例如：回答先给结论，再给依据；证据不足就直说。"
              rows={8}
            />
            <small className="prompt-hint">只写这个 Copilot 的习惯。系统规则不用在这里重复。</small>
          </label>

          <label>
            <span>开场问题（快速启动）</span>
            <textarea
              className="starter-input"
              value={form.startersText || ''}
              onChange={event => setForm(current => ({ ...current, startersText: event.target.value }))}
              placeholder={`每行一个，可用 标签|完整问题
这篇在讲什么
核心观点|用三句话总结这份材料`}
              rows={5}
            />
            <small className="prompt-hint">空对话时显示，点一下就能发出去。</small>
          </label>

          <label>
            <span>长期偏好与记忆</span>
            <textarea
              className="memory-input"
              value={form.memoriesText || ''}
              onChange={event => setForm(current => ({ ...current, memoriesText: event.target.value }))}
              placeholder={`每行一条，例如：
优先给可执行步骤
结论必须带来源`}
              rows={5}
            />
            <small className="prompt-hint">会带到之后的对话里，当长期偏好用。</small>
          </label>
          <label className="memory-switch"><MemoryStick size={17}/><span><b>启用记忆</b><small>在后续会话中使用已保存偏好</small></span><input type="checkbox" checked={form.memoryEnabled !== false} onChange={event => setForm(current => ({ ...current, memoryEnabled: event.target.checked }))}/></label>
        </section>
        <aside className="copilot-skills">
          <h3><LibraryBig size={17}/>绑定知识库</h3>
          <p>不选则沿用当前打开的库；选了就只在这些库里找资料。</p>
          {knowledgeBases.length ? knowledgeBases.map(item => <button type="button" key={item.id} className={(form.knowledgeBaseIds || []).includes(item.id) ? 'selected' : ''} onClick={() => toggleKnowledgeBase(item.id)}><span><b>{item.name}</b><small>{item.documentCount ?? 0} 篇</small></span>{(form.knowledgeBaseIds || []).includes(item.id) && <Check size={15}/>}</button>) : <small>还没有知识库可绑定</small>}
          <h3><Workflow size={17}/>绑定 Skills</h3>
          <div className="copilot-bound-skills">{(form.skillIds || []).length ? skills.filter(skill => (form.skillIds || []).includes(skill.id)).map(skill => <button type="button" key={skill.id} className="is-bound" onClick={() => toggleSkill(skill.id)}>{skill.name}</button>) : <small>还没绑定工作流</small>}</div>
          <details className="copilot-skills-picker">
            <summary>添加能力</summary>
            {skills.filter(skill => !DEMO_SKILL_IDS.has(skill.id)).map(skill => <button type="button" key={skill.id} className={(form.skillIds || []).includes(skill.id) ? 'selected' : ''} onClick={() => toggleSkill(skill.id)}><span><b>{skill.name}</b><small>{skill.description}</small></span>{(form.skillIds || []).includes(skill.id) && <Check size={15}/>}</button>)}
            <details className="copilot-demo-skills">
              <summary>示例能力</summary>
              {skills.filter(skill => DEMO_SKILL_IDS.has(skill.id)).map(skill => <button type="button" key={skill.id} className={(form.skillIds || []).includes(skill.id) ? 'selected' : ''} onClick={() => toggleSkill(skill.id)}><span><b>{skill.name}</b><small>{skill.description}</small></span>{(form.skillIds || []).includes(skill.id) && <Check size={15}/>}</button>)}
            </details>
          </details>
        </aside>
      </div>
    </> : <ModuleWelcome icon={Bot} title="创建你的专属 Copilot" description="为不同工作场景配置独立角色、知识范围、开场问题和长期偏好。" action={createCopilot} actionLabel="创建 Copilot"/>}</main>
  </>;
}
