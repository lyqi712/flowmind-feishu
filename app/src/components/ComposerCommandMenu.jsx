import React, {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState
} from 'react';
import {
  AtSign,
  Clock3,
  Command,
  FileText,
  MessageCircle,
  Paperclip,
  Quote,
  Search,
  Sparkles,
  StickyNote,
  WandSparkles,
  Zap
} from 'lucide-react';
import './ComposerCommandMenu.css';

export const COMPOSER_COMMAND_MENU_MODES = Object.freeze({
  slash: Object.freeze({ id: 'slash', trigger: '/', label: '命令' }),
  mention: Object.freeze({ id: 'mention', trigger: '@', label: '引用' })
});

export const COMMAND_MENU_GROUP_KINDS = Object.freeze({
  skills: 'skills',
  actions: 'actions',
  documents: 'documents',
  attachments: 'attachments',
  context: 'context'
});

const ICONS = Object.freeze({
  action: Zap,
  attachment: Paperclip,
  chat: MessageCircle,
  command: Command,
  context: Quote,
  document: FileText,
  note: StickyNote,
  recent: Clock3,
  search: Search,
  skill: WandSparkles,
  sparkles: Sparkles
});

const MODE_KINDS = Object.freeze({
  slash: new Set(['skill', 'skills', 'action', 'actions', 'common']),
  mention: new Set(['document', 'documents', 'attachment', 'attachments', 'context', 'current-context'])
});

function normalizeMode(mode) {
  if (mode === '@' || mode === 'mention') return 'mention';
  return 'slash';
}

function normalizeSearchValue(value) {
  return String(value ?? '').trim().toLocaleLowerCase();
}

function toSearchText(value) {
  if (Array.isArray(value)) return value.join(' ');
  return String(value ?? '');
}

function supportsMode(group, mode) {
  const explicitModes = group?.modes || (group?.mode ? [group.mode] : []);
  if (explicitModes.length) {
    return explicitModes.some(candidate => normalizeMode(candidate) === mode);
  }

  const kind = normalizeSearchValue(group?.kind);
  if (!kind) return true;
  const knownKinds = new Set([...MODE_KINDS.slash, ...MODE_KINDS.mention]);
  return !knownKinds.has(kind) || MODE_KINDS[mode].has(kind);
}

function makeStableId(value, fallback) {
  const normalized = String(value ?? '')
    .trim()
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || fallback;
}

export function normalizeComposerCommandGroups(groups = [], mode = 'slash') {
  const normalizedMode = normalizeMode(mode);
  const seenGroups = new Set();
  const seenItems = new Set();

  return (Array.isArray(groups) ? groups : [])
    .filter(group => group && supportsMode(group, normalizedMode))
    .map((group, groupIndex) => {
      const groupIdBase = makeStableId(group.id || group.kind, `group-${groupIndex + 1}`);
      let groupId = groupIdBase;
      let suffix = 2;
      while (seenGroups.has(groupId)) groupId = `${groupIdBase}-${suffix++}`;
      seenGroups.add(groupId);

      const items = (Array.isArray(group.items) ? group.items : [])
        .filter(Boolean)
        .map((item, itemIndex) => {
          const itemIdBase = makeStableId(item.id || item.value || item.label, `${groupId}-item-${itemIndex + 1}`);
          let itemId = itemIdBase;
          let itemSuffix = 2;
          while (seenItems.has(itemId)) itemId = `${itemIdBase}-${itemSuffix++}`;
          seenItems.add(itemId);

          return {
            ...item,
            id: itemId,
            label: String(item.label || item.title || '未命名项目'),
            description: String(item.description || item.subtitle || ''),
            keywords: toSearchText(item.keywords),
            disabled: Boolean(item.disabled),
            groupId,
            groupLabel: String(group.label || group.title || ''),
            raw: item
          };
        });

      return {
        ...group,
        id: groupId,
        label: String(group.label || group.title || ''),
        kind: String(group.kind || ''),
        items
      };
    });
}

export function filterComposerCommandGroups(groups = [], query = '') {
  const needle = normalizeSearchValue(query);
  if (!needle) return groups;

  return groups
    .map(group => ({
      ...group,
      items: group.items.filter(item => {
        const haystack = normalizeSearchValue([
          item.label,
          item.description,
          item.keywords,
          item.badge,
          group.label
        ].join(' '));
        return haystack.includes(needle);
      })
    }))
    .filter(group => group.items.length > 0);
}

export function flattenComposerCommandOptions(groups = [], { includeDisabled = true } = {}) {
  const items = groups.flatMap(group => group.items || []);
  return includeDisabled ? items : items.filter(item => !item.disabled);
}

export function resolveComposerCommandNavigation({ key, currentIndex = -1, optionCount = 0 } = {}) {
  const normalizedKey = String(key || '');
  const count = Math.max(0, Number(optionCount) || 0);

  if (normalizedKey === 'Escape') {
    return { action: 'close', index: currentIndex, preventDefault: true };
  }

  if (normalizedKey === 'Enter') {
    return count > 0
      ? { action: 'select', index: currentIndex < 0 ? 0 : Math.min(currentIndex, count - 1), preventDefault: true }
      : { action: 'none', index: -1, preventDefault: false };
  }

  if (!['ArrowDown', 'ArrowUp'].includes(normalizedKey) || count === 0) {
    return { action: 'none', index: currentIndex, preventDefault: false };
  }

  const direction = normalizedKey === 'ArrowDown' ? 1 : -1;
  const safeCurrent = currentIndex >= 0 && currentIndex < count
    ? currentIndex
    : (direction > 0 ? -1 : 0);
  return {
    action: 'move',
    index: (safeCurrent + direction + count) % count,
    preventDefault: true
  };
}

export function highlightCommandMatch(text, query) {
  const value = String(text ?? '');
  const needle = String(query ?? '').trim();
  if (!needle) return value;

  const index = value.toLocaleLowerCase().indexOf(needle.toLocaleLowerCase());
  if (index < 0) return value;

  return (
    <>
      {value.slice(0, index)}
      <mark className="composer-command-menu__highlight">{value.slice(index, index + needle.length)}</mark>
      {value.slice(index + needle.length)}
    </>
  );
}

function resolveIcon(icon, fallback = Command) {
  if (typeof icon === 'function' || (typeof icon === 'object' && icon)) return icon;
  return ICONS[normalizeSearchValue(icon)] || fallback;
}

function restoreAttribute(element, name, previousValue) {
  if (previousValue == null) element.removeAttribute(name);
  else element.setAttribute(name, previousValue);
}

/**
 * Mature command/mention picker for a composer.
 *
 * Important props:
 * - open: controls visibility.
 * - mode: '/', '@', 'slash', or 'mention'.
 * - query: text after the trigger.
 * - groups: [{ id, label, kind, mode/modes, items: [{ id, label, description, keywords, icon, badge, disabled, data }] }].
 * - inputRef: optional textarea/input ref; keyboard and combobox ARIA are wired automatically.
 * - activeId/defaultActiveId/onActiveChange: controlled or uncontrolled active option.
 * - onSelect(item, meta): receives the normalized item and { mode, trigger, query, group, source }.
 * - onClose(meta): called for Escape or selection when closeOnSelect is true.
 */
export default function ComposerCommandMenu({
  open = true,
  mode = 'slash',
  query = '',
  groups = [],
  inputRef,
  activeId,
  defaultActiveId,
  onActiveChange,
  onSelect,
  onClose,
  closeOnSelect = true,
  loading = false,
  loadingLabel = '正在查找…',
  emptyState,
  ariaLabel,
  placement = 'above',
  maxHeight = 360,
  className = ''
}) {
  const normalizedMode = normalizeMode(mode);
  const modeMeta = COMPOSER_COMMAND_MENU_MODES[normalizedMode];
  const reactId = useId();
  const listboxId = `composer-command-menu-${makeStableId(reactId, 'menu')}`;
  const optionRefs = useRef(new Map());

  const normalizedGroups = useMemo(
    () => normalizeComposerCommandGroups(groups, normalizedMode),
    [groups, normalizedMode]
  );
  const filteredGroups = useMemo(
    () => filterComposerCommandGroups(normalizedGroups, query),
    [normalizedGroups, query]
  );
  const enabledOptions = useMemo(
    () => flattenComposerCommandOptions(filteredGroups, { includeDisabled: false }),
    [filteredGroups]
  );
  const allOptions = useMemo(
    () => flattenComposerCommandOptions(filteredGroups),
    [filteredGroups]
  );

  const [internalActiveId, setInternalActiveId] = useState(() => {
    const preferred = String(defaultActiveId || '');
    return enabledOptions.some(item => item.id === preferred)
      ? preferred
      : (enabledOptions[0]?.id || '');
  });
  const isControlled = activeId !== undefined;
  const resolvedActiveId = String(isControlled ? (activeId || '') : internalActiveId);
  const activeOption = enabledOptions.find(item => item.id === resolvedActiveId) || null;
  const activeDomId = activeOption ? `${listboxId}-option-${activeOption.id}` : undefined;

  const setActiveOption = useCallback((item, source = 'programmatic') => {
    if (!item || item.disabled) return;
    if (!isControlled) setInternalActiveId(item.id);
    onActiveChange?.(item.id, item, { mode: normalizedMode, source });
  }, [isControlled, normalizedMode, onActiveChange]);

  useEffect(() => {
    if (!open) return;
    const next = enabledOptions.find(item => item.id === resolvedActiveId) || enabledOptions[0];
    if (!next || next.id === resolvedActiveId) return;
    setActiveOption(next, 'results-change');
  }, [enabledOptions, open, resolvedActiveId, setActiveOption]);

  useEffect(() => {
    if (!open || !activeOption) return;
    optionRefs.current.get(activeOption.id)?.scrollIntoView?.({ block: 'nearest' });
  }, [activeOption, open]);

  const requestClose = useCallback((reason) => {
    onClose?.({ reason, mode: normalizedMode, trigger: modeMeta.trigger, query });
  }, [modeMeta.trigger, normalizedMode, onClose, query]);

  const selectOption = useCallback((item, source = 'keyboard') => {
    if (!item || item.disabled) return false;
    const group = filteredGroups.find(candidate => candidate.id === item.groupId) || null;
    onSelect?.(item, {
      mode: normalizedMode,
      trigger: modeMeta.trigger,
      query,
      group,
      source
    });
    if (closeOnSelect) requestClose('selection');
    return true;
  }, [closeOnSelect, filteredGroups, modeMeta.trigger, normalizedMode, onSelect, query, requestClose]);

  const handleKeyDown = useCallback((event) => {
    if (!open || event.defaultPrevented || event.isComposing) return;
    const currentIndex = enabledOptions.findIndex(item => item.id === resolvedActiveId);
    const result = resolveComposerCommandNavigation({
      key: event.key,
      currentIndex,
      optionCount: enabledOptions.length
    });

    if (result.preventDefault) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (result.action === 'move') setActiveOption(enabledOptions[result.index], 'keyboard');
    if (result.action === 'select') selectOption(enabledOptions[result.index], 'keyboard');
    if (result.action === 'close') requestClose('escape');
  }, [enabledOptions, open, requestClose, resolvedActiveId, selectOption, setActiveOption]);

  useEffect(() => {
    const input = inputRef?.current;
    if (!input || !open) return undefined;
    input.addEventListener('keydown', handleKeyDown);
    return () => input.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown, inputRef, open]);

  useEffect(() => {
    const input = inputRef?.current;
    if (!input) return undefined;

    const attributes = {
      'aria-controls': input.getAttribute('aria-controls'),
      'aria-expanded': input.getAttribute('aria-expanded'),
      'aria-haspopup': input.getAttribute('aria-haspopup'),
      'aria-activedescendant': input.getAttribute('aria-activedescendant')
    };

    input.setAttribute('aria-controls', listboxId);
    input.setAttribute('aria-expanded', String(Boolean(open)));
    input.setAttribute('aria-haspopup', 'listbox');
    if (open && activeDomId) input.setAttribute('aria-activedescendant', activeDomId);
    else input.removeAttribute('aria-activedescendant');

    return () => {
      Object.entries(attributes).forEach(([name, value]) => restoreAttribute(input, name, value));
    };
  }, [activeDomId, inputRef, listboxId, open]);

  if (!open) return null;

  const defaultEmptyState = normalizedMode === 'slash'
    ? { title: '没有匹配的 Skill 或动作', description: '换个关键词，或输入 / 查看全部命令。' }
    : { title: '没有匹配的文档或上下文', description: '换个关键词，或输入 @ 浏览可引用内容。' };
  const resolvedEmptyState = { ...defaultEmptyState, ...(emptyState || {}) };
  const menuClassName = [
    'composer-command-menu',
    `composer-command-menu--${normalizedMode}`,
    `composer-command-menu--${placement === 'below' ? 'below' : 'above'}`,
    className
  ].filter(Boolean).join(' ');

  return (
    <section
      className={menuClassName}
      data-mode={normalizedMode}
      data-trigger={modeMeta.trigger}
      aria-label={ariaLabel || `${modeMeta.label}菜单`}
      onKeyDown={handleKeyDown}
      style={{ '--composer-command-menu-max-height': `${Math.max(180, Number(maxHeight) || 360)}px` }}
    >
      <header className="composer-command-menu__header">
        <span className="composer-command-menu__trigger" aria-hidden="true">
          {normalizedMode === 'mention' ? <AtSign size={15} /> : modeMeta.trigger}
        </span>
        <div className="composer-command-menu__heading">
          <strong>{normalizedMode === 'slash' ? '调用 Skill 与动作' : '添加知识与上下文'}</strong>
          <span>{query ? `搜索“${query}”` : (normalizedMode === 'slash' ? '输入名称快速执行' : '引用后可继续追问')}</span>
        </div>
        <span className="composer-command-menu__result-count" aria-live="polite">
          {loading ? '…' : `${allOptions.length} 项`}
        </span>
      </header>

      <div
        id={listboxId}
        className="composer-command-menu__list"
        role="listbox"
        aria-label={ariaLabel || `${modeMeta.label}选项`}
        aria-activedescendant={activeDomId}
        aria-busy={loading ? 'true' : 'false'}
      >
        {loading ? (
          <div className="composer-command-menu__state" role="status">
            <span className="composer-command-menu__spinner" aria-hidden="true" />
            <strong>{loadingLabel}</strong>
            <span>正在整理最相关的结果</span>
          </div>
        ) : filteredGroups.length === 0 ? (
          <div className="composer-command-menu__state composer-command-menu__state--empty" role="status">
            <Search size={22} aria-hidden="true" />
            <strong>{resolvedEmptyState.title}</strong>
            <span>{resolvedEmptyState.description}</span>
          </div>
        ) : filteredGroups.map(group => (
          <div className="composer-command-menu__group" key={group.id} role="presentation">
            {group.label ? (
              <div className="composer-command-menu__group-label" role="presentation">
                <span>{group.label}</span>
                <span>{group.items.length}</span>
              </div>
            ) : null}
            <div className="composer-command-menu__group-options" role="presentation">
              {group.items.map(item => {
                const ItemIcon = resolveIcon(item.icon, normalizedMode === 'slash' ? WandSparkles : FileText);
                const selected = item.id === resolvedActiveId && !item.disabled;
                const optionId = `${listboxId}-option-${item.id}`;
                return (
                  <button
                    ref={node => {
                      if (node) optionRefs.current.set(item.id, node);
                      else optionRefs.current.delete(item.id);
                    }}
                    id={optionId}
                    key={item.id}
                    type="button"
                    className={`composer-command-menu__option${selected ? ' is-active' : ''}`}
                    role="option"
                    aria-selected={selected ? 'true' : 'false'}
                    aria-disabled={item.disabled ? 'true' : undefined}
                    disabled={item.disabled}
                    tabIndex={-1}
                    onMouseMove={() => setActiveOption(item, 'pointer')}
                    onMouseDown={event => event.preventDefault()}
                    onClick={() => selectOption(item, 'pointer')}
                  >
                    <span className="composer-command-menu__icon" aria-hidden="true">
                      <ItemIcon size={18} strokeWidth={1.9} />
                    </span>
                    <span className="composer-command-menu__copy">
                      <span className="composer-command-menu__label">
                        {highlightCommandMatch(item.label, query)}
                        {item.badge ? <span className="composer-command-menu__badge">{item.badge}</span> : null}
                      </span>
                      {item.description ? (
                        <span className="composer-command-menu__description">
                          {highlightCommandMatch(item.description, query)}
                        </span>
                      ) : null}
                    </span>
                    {item.shortcut ? <kbd className="composer-command-menu__shortcut">{item.shortcut}</kbd> : null}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <footer className="composer-command-menu__footer" aria-hidden="true">
        <span><kbd>↑</kbd><kbd>↓</kbd> 选择</span>
        <span><kbd>Enter</kbd> 使用</span>
        <span><kbd>Esc</kbd> 关闭</span>
      </footer>
    </section>
  );
}
