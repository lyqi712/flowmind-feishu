import React, { useState } from 'react';
import { Check, ChevronDown, CircleAlert, LoaderCircle, Square } from 'lucide-react';
import { reasoningSummary } from '../workspace/reasoning-chain.js';

export function ReasoningChain({ steps = [], defaultExpanded = false }) {
  const [expanded, setExpanded] = useState(Boolean(defaultExpanded));
  const list = Array.isArray(steps) ? steps : [];
  if (!list.length) return null;

  return (
    <div className="reasoning-chain">
      <button type="button" className="reasoning-chain-toggle" onClick={() => setExpanded(current => !current)} aria-expanded={expanded}>
        <span>{expanded ? '收起' : '展开'} AI 推理过程</span>
        <small>{reasoningSummary(list)}</small>
        <ChevronDown size={14} className={expanded ? 'is-rotated' : ''} />
      </button>
      {expanded ? (
        <ol className="reasoning-steps">
          {list.map(step => (
            <li key={step.id || step.step} className={`reasoning-step is-${step.status || 'pending'}`}>
              <div className="reasoning-step-header">
                {step.status === 'completed' ? <Check size={14} /> : null}
                {step.status === 'in_progress' ? <LoaderCircle size={14} className="spin" /> : null}
                {step.status === 'failed' ? <CircleAlert size={14} /> : null}
                {step.status === 'cancelled' ? <Square size={12} /> : null}
                <b>{step.title}</b>
              </div>
              {step.detail ? <div className="reasoning-step-detail">{step.detail}</div> : null}
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
