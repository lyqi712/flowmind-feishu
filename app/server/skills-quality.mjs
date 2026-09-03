import { SKILLS } from './skills.mjs';

/** Skill 输出质量验证和修复 */

// Skill 输出质量标准
const SKILL_QUALITY_SCHEMAS = {
  summary: {
    name: '总结',
    requiredPatterns: [
      { pattern: /主题|核心|要点|关键/i, description: '必须包含主题或核心要点' },
      { pattern: /\[\d+\]/g, description: '必须包含引用标注', minCount: 1 }
    ],
    minLength: 150,
    maxLength: 3000,
    forbiddenPatterns: [
      { pattern: /\[source\b/i, description: '不能包含内部标记 [source]' },
      { pattern: /\[source-id\b/i, description: '不能包含内部标记 [source-id]' },
      { pattern: /围绕.*?展开/g, description: '避免空泛表述"围绕X展开"' }
    ]
  },

  compare: {
    name: '对比',
    requiredPatterns: [
      { pattern: /\|/g, description: '必须包含对比表格', minCount: 4 }, // 至少4个|才算完整表格
      { pattern: /差异|不同|区别|对比|相同|共同/i, description: '必须明确指出差异或共同点' },
      { pattern: /\[\d+\]/g, description: '必须包含引用标注', minCount: 2 }
    ],
    minLength: 200,
    forbiddenPatterns: [
      { pattern: /\[source\b/i, description: '不能包含内部标记' },
      { pattern: /材料不均衡/g, description: '不要声明"材料不均衡"' }
    ]
  },

  'research-report': {
    name: '研究报告',
    requiredPatterns: [
      { pattern: /执行摘要|关键发现|研究发现|核心结论|摘要/i, description: '必须包含执行摘要或关键发现' },
      { pattern: /建议|推荐|行动|结论/i, description: '必须包含建议或行动项' },
      { pattern: /\[\d+\]/g, description: '必须包含引用标注', minCount: 3 }
    ],
    minLength: 400, // 降低最低长度要求
    forbiddenPatterns: [
      { pattern: /\[source\b/i, description: '不能包含内部标记' }
    ]
  },

  'q2-planning': {
    name: 'Q2规划',
    requiredPatterns: [
      { pattern: /目标|规划|计划/i, description: '必须包含明确目标' },
      { pattern: /Q1|第一季度|上季度/i, description: '必须引用Q1数据' },
      { pattern: /\[\d+\]/g, description: '必须包含引用标注', minCount: 2 }
    ],
    minLength: 300,
    forbiddenPatterns: []
  },

  'tech-selection': {
    name: '技术选型',
    requiredPatterns: [
      { pattern: /方案|技术|架构|选型/i, description: '必须包含技术方案' },
      { pattern: /优势|劣势|优点|缺点|风险/i, description: '必须分析优劣势' },
      { pattern: /\[\d+\]/g, description: '必须包含引用标注', minCount: 1 }
    ],
    minLength: 250,
    forbiddenPatterns: []
  },

  'customer-proposal': {
    name: '客户提案',
    requiredPatterns: [
      { pattern: /方案|解决方案|价值|收益/i, description: '必须包含解决方案' },
      { pattern: /\[\d+\]/g, description: '必须包含引用标注', minCount: 1 }
    ],
    minLength: 300,
    forbiddenPatterns: []
  }
};

/** 验证 Skill 输出质量 */
export function validateSkillOutput(skillId, output, evidenceCount = 0) {
  const schema = SKILL_QUALITY_SCHEMAS[skillId];
  if (!schema) {
    return { valid: true, score: 100, issues: [], warnings: [] };
  }

  const issues = [];
  const warnings = [];
  const text = String(output || '');

  // 检查长度
  if (schema.minLength && text.length < schema.minLength) {
    issues.push({
      type: 'length',
      severity: 'error',
      message: `内容过短（${text.length}字），需要至少 ${schema.minLength} 字`,
      autoFixable: false
    });
  }

  if (schema.maxLength && text.length > schema.maxLength) {
    warnings.push({
      type: 'length',
      severity: 'warning',
      message: `内容较长（${text.length}字），建议控制在 ${schema.maxLength} 字以内`,
      autoFixable: false
    });
  }

  // 检查必需模式
  if (schema.requiredPatterns) {
    schema.requiredPatterns.forEach(req => {
      const matches = text.match(req.pattern);
      const count = matches ? matches.length : 0;
      const minCount = req.minCount || 1;

      if (count < minCount) {
        issues.push({
          type: 'missing-pattern',
          severity: 'error',
          message: req.description + (req.minCount ? ` (需要至少 ${minCount} 处，当前 ${count} 处)` : ''),
          pattern: req.pattern.source,
          autoFixable: req.pattern.source.includes('\\[\\d+\\]') // 引用可以自动修复
        });
      }
    });
  }

  // 检查禁止模式
  if (schema.forbiddenPatterns) {
    schema.forbiddenPatterns.forEach(forbidden => {
      const matches = text.match(forbidden.pattern);
      if (matches) {
        issues.push({
          type: 'forbidden-pattern',
          severity: 'error',
          message: `${forbidden.description} (发现 ${matches.length} 处)`,
          pattern: forbidden.pattern.source,
          matches: matches.slice(0, 3), // 只显示前3个
          autoFixable: true
        });
      }
    });
  }

  // 检查引用编号是否合法
  const citations = [...text.matchAll(/\[(\d+)\]/g)].map(m => parseInt(m[1]));
  const invalidCitations = citations.filter(n => n < 1 || n > evidenceCount);
  if (invalidCitations.length > 0 && evidenceCount > 0) {
    issues.push({
      type: 'invalid-citation',
      severity: 'error',
      message: `引用编号超出范围：${invalidCitations.join(', ')} (证据总数: ${evidenceCount})`,
      autoFixable: true
    });
  }

  // 计算质量分数
  const errorCount = issues.filter(i => i.severity === 'error').length;
  const warningCount = warnings.length;
  const score = Math.max(0, 100 - errorCount * 20 - warningCount * 5);

  return {
    valid: issues.length === 0,
    score,
    issues,
    warnings,
    skillName: schema.name,
    evidenceCount
  };
}

/** 自动修复 Skill 输出中的常见问题 */
export function autoRepairSkillOutput(output, issues, evidenceCount = 0) {
  let repaired = String(output || '');
  const appliedFixes = [];

  issues.forEach(issue => {
    if (!issue.autoFixable) return;

    switch (issue.type) {
      case 'forbidden-pattern':
        // 移除禁止的模式
        if (issue.pattern.includes('\\[source\\b')) {
          const before = repaired;
          repaired = repaired.replace(/\[source\b[^\]]*\]/gi, '');
          if (before !== repaired) {
            appliedFixes.push('移除了内部标记 [source]');
          }
        }
        if (issue.pattern.includes('\\[source-id\\b')) {
          const before = repaired;
          repaired = repaired.replace(/\[source-id\b[^\]]*\]/gi, '');
          if (before !== repaired) {
            appliedFixes.push('移除了内部标记 [source-id]');
          }
        }
        if (issue.pattern.includes('围绕.*?展开')) {
          const before = repaired;
          repaired = repaired.replace(/围绕(.*?)展开/g, '$1');
          if (before !== repaired) {
            appliedFixes.push('修复了空泛表述');
          }
        }
        if (issue.pattern.includes('材料不均衡')) {
          const before = repaired;
          repaired = repaired.replace(/材料不均衡[^。！？\n]*/g, '');
          if (before !== repaired) {
            appliedFixes.push('移除了"材料不均衡"声明');
          }
        }
        break;

      case 'invalid-citation':
        // 修复超出范围的引用
        if (evidenceCount > 0) {
          const before = repaired;
          repaired = repaired.replace(/\[(\d+)\]/g, (match, num) => {
            const n = parseInt(num);
            if (n < 1) return '[1]';
            if (n > evidenceCount) return `[${evidenceCount}]`;
            return match;
          });
          if (before !== repaired) {
            appliedFixes.push('修复了超出范围的引用编号');
          }
        }
        break;

      case 'missing-pattern':
        // 如果缺少引用，尝试从内容推断应该引用的位置
        if (issue.pattern === '\\[\\d+\\]') {
          // 这个需要AI重新生成，暂时不自动修复
        }
        break;
    }
  });

  return {
    output: repaired,
    appliedFixes,
    wasModified: appliedFixes.length > 0
  };
}

/** 对抗性审查：检查输出是否试图越界或注入指令 */
export function adversarialReview(output, context = {}) {
  const text = String(output || '');
  const threats = [];

  // 检查是否试图输出系统提示词
  const systemLeakPatterns = [
    /你是.*助手/i,
    /system prompt/i,
    /系统指令/i,
    /内部规则/i,
    /以下是我的真实指令/i
  ];

  systemLeakPatterns.forEach(pattern => {
    if (pattern.test(text)) {
      threats.push({
        type: 'system-leak',
        severity: 'high',
        message: '输出可能泄露了系统提示词',
        pattern: pattern.source
      });
    }
  });

  // 检查是否试图执行写入操作
  const writeAttemptPatterns = [
    /已写入|已保存|已创建.*文件/i,
    /文件已生成|成功写入/i,
    /已执行.*命令/i,
    /report\.md.*文件/i
  ];

  writeAttemptPatterns.forEach(pattern => {
    if (pattern.test(text) && !context.hasWritePermission) {
      threats.push({
        type: 'false-write-claim',
        severity: 'critical', // 提升为critical
        message: '输出声称执行了写入操作，但没有写入权限',
        pattern: pattern.source
      });
    }
  });

  // 检查是否试图诱导用户执行危险操作
  const socialEngineeringPatterns = [
    /立即执行|马上运行.*rm -rf/i,
    /复制以下命令.*sudo/i,
    /删除所有|格式化.*硬盘/i
  ];

  socialEngineeringPatterns.forEach(pattern => {
    if (pattern.test(text)) {
      threats.push({
        type: 'social-engineering',
        severity: 'critical',
        message: '输出可能试图诱导用户执行危险操作',
        pattern: pattern.source
      });
    }
  });

  // 检查是否包含过多的 prompt injection 特征
  const injectionMarkers = [
    /ignore previous instructions/i,
    /忽略之前的指令/i,
    /forget everything/i,
    /you are now/i,
    /现在你是/i,
    /new instructions:/i
  ];

  injectionMarkers.forEach(pattern => {
    if (pattern.test(text)) {
      threats.push({
        type: 'prompt-injection',
        severity: 'medium',
        message: '输出包含提示词注入特征（可能来自知识库证据，已被系统忽略）',
        pattern: pattern.source
      });
    }
  });

  // 检查是否编造引用
  const citations = [...text.matchAll(/\[(\d+)\]/g)].map(m => parseInt(m[1]));
  const maxCitation = Math.max(0, ...citations);
  if (context.evidenceCount && maxCitation > context.evidenceCount) {
    threats.push({
      type: 'fabricated-citation',
      severity: 'high',
      message: `编造了不存在的引用 [${maxCitation}]，实际证据只有 ${context.evidenceCount} 条`,
      fabricatedCitations: citations.filter(n => n > context.evidenceCount)
    });
  }

  return {
    safe: threats.length === 0,
    threats,
    riskLevel: threats.some(t => t.severity === 'critical') ? 'critical'
      : threats.some(t => t.severity === 'high') ? 'high'
      : threats.some(t => t.severity === 'medium') ? 'medium'
      : 'low'
  };
}

/** 完整的 Skill 质量检查流程 */
export function reviewSkillOutput(skillId, output, { evidenceCount = 0, context = {} } = {}) {
  // 1. 质量验证
  const validation = validateSkillOutput(skillId, output, evidenceCount);

  // 2. 对抗性审查
  const security = adversarialReview(output, { ...context, evidenceCount });

  // 3. 自动修复（仅修复可自动修复的问题）
  let finalOutput = output;
  let repairLog = [];

  if (!validation.valid) {
    const autoFixableIssues = validation.issues.filter(i => i.autoFixable);
    if (autoFixableIssues.length > 0) {
      const repair = autoRepairSkillOutput(output, autoFixableIssues, evidenceCount);
      finalOutput = repair.output;
      repairLog = repair.appliedFixes;

      // 重新验证修复后的输出
      const revalidation = validateSkillOutput(skillId, finalOutput, evidenceCount);
      validation.issues = revalidation.issues;
      validation.valid = revalidation.valid;
      validation.score = revalidation.score;
    }
  }

  return {
    valid: validation.valid && security.safe,
    score: validation.score,
    quality: validation,
    security,
    repaired: repairLog.length > 0,
    repairLog,
    output: finalOutput,
    needsRegeneration: validation.issues.some(i => !i.autoFixable) || security.riskLevel === 'critical'
  };
}

export { SKILL_QUALITY_SCHEMAS };
