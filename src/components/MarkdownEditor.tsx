import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { SplitSquareHorizontal, X, Bot, Code } from 'lucide-react';
import { Note } from '../types';

interface MarkdownEditorProps {
  content: string;
  title: string;
  onChangeContent: (value: string) => void;
  onChangeTitle: (value: string) => void;
  readOnly?: boolean;
  notes?: Note[];
  onSplit?: () => void;
  onClosePane?: () => void;
  showCloseButton?: boolean;
  isFocused?: boolean;
  aiPaneOpen?: boolean;
  onToggleAIPane?: () => void;
  disableAIToggle?: boolean;
  keybindSplitBlock?: string;
  keybindNewLine?: string;
}

type EditorViewMode = 'live' | 'raw';

function matchesKeybind(e: React.KeyboardEvent, keybindStr: string = '') {
  if (!keybindStr) return false;
  const parts = keybindStr.toLowerCase().split('+').map(p => p.trim());
  const needsCtrl = parts.includes('ctrl');
  const needsAlt = parts.includes('alt');
  const needsShift = parts.includes('shift');
  const needsMeta = parts.includes('meta') || parts.includes('cmd');
  
  const key = parts.filter(p => !['ctrl', 'alt', 'shift', 'meta', 'cmd'].includes(p))[0];
  
  if (!!e.ctrlKey !== needsCtrl) return false;
  if (!!e.altKey !== needsAlt) return false;
  if (!!e.shiftKey !== needsShift) return false;
  if (!!e.metaKey !== needsMeta) return false;
  
  return e.key.toLowerCase() === key;
}

// Regex to detect existing GFM task list syntax:  - [ ]  or  - [x]  (with optional * or + bullet)
const TASK_LINE_RE = /^(\s*[-*+]\s+)\[( |x)\]\s?/i;

function splitMarkdownIntoBlocks(markdown: string): string[] {
  if (!markdown) return [''];
  
  const blocks: string[] = [];
  const lines = markdown.split('\n');
  let currentBlock: string[] = [];
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
    }

    if (!inCodeBlock && line.trim() === '') {
      if (currentBlock.length > 0) {
        blocks.push(currentBlock.join('\n'));
        currentBlock = [];
      } else {
        currentBlock.push(line);
      }
    } else {
      currentBlock.push(line);
    }
  }

  if (currentBlock.length > 0) {
    blocks.push(currentBlock.join('\n'));
  }

  return blocks.length > 0 ? blocks : [''];
}

function toggleCheckboxInMarkdown(markdown: string, checkboxIndex: number): string {
  let count = 0;
  const lines = markdown.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (TASK_LINE_RE.test(lines[i])) {
      if (count === checkboxIndex) {
        lines[i] = lines[i].replace(TASK_LINE_RE, (_, bullet, state) =>
          state.toLowerCase() === 'x' ? `${bullet}[ ] ` : `${bullet}[x] `
        );
        break;
      }
      count++;
    }
  }
  return lines.join('\n');
}

// --- Helper: Caret Coordinates ---
const getCaretOffset = (element: HTMLTextAreaElement, position: number) => {
  const style = window.getComputedStyle(element);
  const div = document.createElement('div');
  
  const styleProperties = [
    'direction', 'boxSizing', 'width', 'height', 'overflowX', 'overflowY',
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
    'borderStyle', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'fontStyle', 'fontVariant', 'fontWeight', 'fontStretch', 'fontSize',
    'fontSizeAdjust', 'lineHeight', 'fontFamily', 'textAlign',
    'textTransform', 'whiteSpace', 'wordBreak', 'wordWrap', 'letterSpacing',
    'tabSize', 'MozTabSize'
  ] as const;

  styleProperties.forEach(prop => {
    // @ts-ignore
    div.style[prop] = style[prop];
  });

  div.style.position = 'absolute';
  div.style.visibility = 'hidden';
  div.style.whiteSpace = 'pre-wrap';
  div.style.wordWrap = 'break-word';

  div.textContent = element.value.substring(0, position);

  const span = document.createElement('span');
  span.textContent = element.value.substring(position) || '.';
  div.appendChild(span);

  element.parentNode?.appendChild(div);

  const top = span.offsetTop - element.scrollTop;
  const left = span.offsetLeft - element.scrollLeft;

  element.parentNode?.removeChild(div);

  return {
    top: top + element.offsetTop + parseFloat(style.lineHeight || '24'),
    left: left + element.offsetLeft
  };
};

function escapeRegExp(string: string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const MarkdownEditor: React.FC<MarkdownEditorProps> = ({
  content,
  title,
  onChangeContent,
  onChangeTitle,
  readOnly = false,
  notes = [],
  onSplit,
  onClosePane,
  showCloseButton = false,
  isFocused = false,
  aiPaneOpen = false,
  onToggleAIPane,
  disableAIToggle = false,
  keybindSplitBlock = 'Enter',
  keybindNewLine = 'Shift+Enter'
}) => {
  const [viewMode, setViewMode] = useState<EditorViewMode>('live');
  
  // Live Preview Block State
  const [blocks, setBlocks] = useState<string[]>(() => splitMarkdownIntoBlocks(content));
  const [lastPropagatedContent, setLastPropagatedContent] = useState(content);
  const [activeBlockIndex, setActiveBlockIndex] = useState<number | null>(null);
  const [pendingCaretPos, setPendingCaretPos] = useState<{ index: number, position: number } | null>(null);

  // Sync from props if content changes externally (e.g. AI writes, or different note loads)
  useEffect(() => {
    if (content !== lastPropagatedContent) {
      setBlocks(splitMarkdownIntoBlocks(content));
      setLastPropagatedContent(content);
    }
  }, [content, lastPropagatedContent]);

  // Autocomplete State
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [suggestionsCoords, setSuggestionsCoords] = useState({ top: 0, left: 0 });
  const [query, setQuery] = useState('');
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);
  const isOverSuggestionsRef = useRef(false);

  // Manage programmatic focus and caret placement for blocks
  useEffect(() => {
    if (activeBlockIndex !== null) {
      const el = document.getElementById(`block-textarea-${activeBlockIndex}`) as HTMLTextAreaElement;
      if (el) {
        el.style.height = 'auto';
        el.style.height = `${el.scrollHeight}px`;
        if (document.activeElement !== el) {
          el.focus();
          if (pendingCaretPos && pendingCaretPos.index === activeBlockIndex) {
            el.setSelectionRange(pendingCaretPos.position, pendingCaretPos.position);
            setPendingCaretPos(null);
          }
        }
      }
    }
  }, [activeBlockIndex, pendingCaretPos, content]);

  const handleBlockChange = (idx: number, newBlockVal: string) => {
    if (readOnly) return;
    const newBlocks = [...blocks];
    newBlocks[idx] = newBlockVal;
    setBlocks(newBlocks);
    const newContent = newBlocks.join('\n\n');
    setLastPropagatedContent(newContent);
    onChangeContent(newContent);
  };

  const handleCheckboxToggle = useCallback((blockIdx: number, checkboxIndex: number) => {
    if (readOnly) return;
    const newBlocks = [...blocks];
    newBlocks[blockIdx] = toggleCheckboxInMarkdown(newBlocks[blockIdx], checkboxIndex);
    setBlocks(newBlocks);
    const newContent = newBlocks.join('\n\n');
    setLastPropagatedContent(newContent);
    onChangeContent(newContent);
  }, [blocks, onChangeContent, readOnly]);

  const checkWikilinkQuery = (textarea: HTMLTextAreaElement) => {
    if (!textarea || readOnly) return;

    const text = textarea.value;
    const cursorPos = textarea.selectionStart;
    const textBeforeCursor = text.slice(0, cursorPos);
    const lastLineBreak = textBeforeCursor.lastIndexOf('\n');
    const currentLineText = textBeforeCursor.slice(lastLineBreak + 1);

    const lastOpenBracket = currentLineText.lastIndexOf('[[');
    const lastCloseBracket = currentLineText.lastIndexOf(']]');

    if (lastOpenBracket !== -1 && lastOpenBracket > lastCloseBracket) {
      const q = currentLineText.slice(lastOpenBracket + 2);
      setQuery(prevQ => {
        if (prevQ !== q) setSelectedSuggestionIndex(0);
        return q;
      });
      const coords = getCaretOffset(textarea, cursorPos);
      setSuggestionsCoords(coords);
      setSuggestionsOpen(true);
    } else {
      setSuggestionsOpen(false);
    }
  };

  const filteredSuggestions = useMemo(() => {
    if (!notes) return [];
    const lowercaseQuery = query.toLowerCase();
    if (!lowercaseQuery) return notes.map(n => n.title).filter(Boolean).slice(0, 10);

    const matches = notes.filter(n => n.title && n.title.toLowerCase().includes(lowercaseQuery));
    return matches
      .map(note => {
        const t = note.title;
        const lowerTitle = t.toLowerCase();
        let score = 0;
        if (lowerTitle === lowercaseQuery) score = 100; 
        else if (lowerTitle.startsWith(lowercaseQuery)) score = 80; 
        else if (new RegExp(`\\b${escapeRegExp(lowercaseQuery)}`).test(lowerTitle)) score = 60; 
        else score = 40; 
        return { title: t, score };
      })
      .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
      .map(item => item.title);
  }, [notes, query]);

  const handleSelectNote = (noteTitle: string) => {
    const textarea = document.activeElement as HTMLTextAreaElement;
    if (!textarea || textarea.tagName !== 'TEXTAREA') return;

    const text = textarea.value;
    const cursorPos = textarea.selectionStart;
    const textBeforeCursor = text.slice(0, cursorPos);
    const lastIndex = textBeforeCursor.lastIndexOf('[[');
    if (lastIndex === -1) return;

    const textAfterCursor = text.slice(cursorPos);
    const newTextBeforeCursor = textBeforeCursor.slice(0, lastIndex) + `[[${noteTitle}]]`;
    let newTextAfterCursor = textAfterCursor;
    if (textAfterCursor.startsWith(']]')) {
      newTextAfterCursor = textAfterCursor.slice(2);
    }

    const newBlockVal = newTextBeforeCursor + newTextAfterCursor;
    const newCursorPos = newTextBeforeCursor.length;

    if (viewMode === 'live') {
      if (activeBlockIndex !== null) {
        const newBlocks = [...blocks];
        newBlocks[activeBlockIndex] = newBlockVal;
        setBlocks(newBlocks);
        const newContent = newBlocks.join('\n\n');
        setLastPropagatedContent(newContent);
        onChangeContent(newContent);
        setPendingCaretPos({ index: activeBlockIndex, position: newCursorPos });
      }
    } else {
      const newContent = newBlockVal;
      setLastPropagatedContent(newContent);
      onChangeContent(newContent);
      setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(newCursorPos, newCursorPos);
      }, 0);
    }

    setSuggestionsOpen(false);
  };

  const handleAutocompleteKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (suggestionsOpen && filteredSuggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedSuggestionIndex(prev => (prev + 1) % filteredSuggestions.length);
        return true;
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedSuggestionIndex(prev => (prev - 1 + filteredSuggestions.length) % filteredSuggestions.length);
        return true;
      } else if (e.key === 'Enter') {
        e.preventDefault();
        handleSelectNote(filteredSuggestions[selectedSuggestionIndex]);
        return true;
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setSuggestionsOpen(false);
        return true;
      }
    }
    return false;
  };

  const handleBlockKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>, idx: number) => {
    if (readOnly) return;
    const textarea = e.currentTarget;

    const isSplit = matchesKeybind(e, keybindSplitBlock);
    const isNewLine = matchesKeybind(e, keybindNewLine);

    if (isSplit) {
      e.preventDefault();
      const cursorPos = textarea.selectionStart;
      const text = textarea.value;
      const part1 = text.slice(0, cursorPos);
      const part2 = text.slice(cursorPos);

      const newBlocks = [...blocks];
      newBlocks[idx] = part1;
      newBlocks.splice(idx + 1, 0, part2);
      
      setBlocks(newBlocks);
      const newContent = newBlocks.join('\n\n');
      setLastPropagatedContent(newContent);
      onChangeContent(newContent);
      setActiveBlockIndex(idx + 1);
      setPendingCaretPos({ index: idx + 1, position: 0 });
    } else if (isNewLine) {
      if (e.key !== 'Enter') {
        e.preventDefault();
        const cursorPos = textarea.selectionStart;
        const text = textarea.value;
        const newVal = text.slice(0, cursorPos) + '\n' + text.slice(cursorPos);
        const newBlocks = [...blocks];
        newBlocks[idx] = newVal;
        setBlocks(newBlocks);
        const newContent = newBlocks.join('\n\n');
        setLastPropagatedContent(newContent);
        onChangeContent(newContent);
        setPendingCaretPos({ index: idx, position: cursorPos + 1 });
      }
    } else if (e.key === 'Backspace' && textarea.selectionStart === 0 && textarea.selectionEnd === 0) {
      if (idx > 0) {
        e.preventDefault();
        const prevBlockText = blocks[idx - 1];
        const currentBlockText = textarea.value;
        
        const newBlocks = [...blocks];
        newBlocks[idx - 1] = prevBlockText + currentBlockText;
        newBlocks.splice(idx, 1);
        
        setBlocks(newBlocks);
        const newContent = newBlocks.join('\n\n');
        setLastPropagatedContent(newContent);
        onChangeContent(newContent);
        setActiveBlockIndex(idx - 1);
        setPendingCaretPos({ index: idx - 1, position: prevBlockText.length });
      }
    } else if (e.key === 'ArrowUp' && textarea.selectionStart === 0) {
      if (idx > 0) {
        e.preventDefault();
        setActiveBlockIndex(idx - 1);
        setPendingCaretPos({ index: idx - 1, position: blocks[idx - 1].length });
      }
    } else if (e.key === 'ArrowDown' && textarea.selectionStart === textarea.value.length) {
      if (idx < blocks.length - 1) {
        e.preventDefault();
        setActiveBlockIndex(idx + 1);
        setPendingCaretPos({ index: idx + 1, position: 0 });
      }
    }
  };

  return (
    <div className={`flex flex-col h-full w-full bg-obsidian-bg text-obsidian-text transition-all duration-200 ${isFocused ? 'ring-1 ring-inset ring-obsidian-accent/50 bg-obsidian-sidebar/20' : ''}`}>
      {/* Header: Title + View Toggles */}
      <div className="flex items-center gap-4 p-4 md:p-8 pb-4 border-b border-obsidian-border/50 bg-black/10">
        <input
          type="text"
          value={title}
          onChange={(e) => onChangeTitle(e.target.value)}
          placeholder="Untitled Note"
          className="flex-1 bg-transparent text-2xl md:text-4xl font-bold focus:outline-none placeholder-gray-700 min-w-0"
          readOnly={readOnly}
        />

        <div className="flex items-center gap-1">
          {/* Raw Text toggle */}
          <button
            onClick={() => setViewMode(viewMode === 'raw' ? 'live' : 'raw')}
            className={`p-2 rounded transition-all duration-150 ${
              viewMode === 'raw'
                ? 'text-obsidian-accent bg-obsidian-accent/15 hover:bg-obsidian-accent/25'
                : 'text-gray-400 hover:text-white hover:bg-white/10'
            }`}
            title={viewMode === 'raw' ? 'Switch to Live Preview' : 'Switch to Raw Text View'}
          >
            <Code className="w-5 h-5" />
          </button>

          {/* Split Pane */}
          {onSplit && (
            <button
              onClick={onSplit}
              className="p-2 ml-2 rounded transition-all duration-150 text-gray-400 hover:text-white hover:bg-white/10"
              title="Split Note View"
            >
              <SplitSquareHorizontal className="w-5 h-5" />
            </button>
          )}

          {/* Close Pane */}
          {showCloseButton && onClosePane && (
            <button
              onClick={onClosePane}
              className="p-2 ml-1 rounded transition-all duration-150 text-gray-400 hover:text-red-400 hover:bg-red-500/10"
              title="Close Pane"
            >
              <X className="w-5 h-5" />
            </button>
          )}

          {/* AI Toggle */}
          {onToggleAIPane && (
            <button
              onClick={onToggleAIPane}
              className={`p-2 ml-2 rounded transition-all duration-150 ${aiPaneOpen ? 'text-obsidian-accent bg-obsidian-accent/15 hover:bg-obsidian-accent/25' : 'text-gray-400 hover:text-white hover:bg-white/10'} ${disableAIToggle ? 'opacity-30 cursor-not-allowed' : ''}`}
              title={disableAIToggle ? "AI is disabled in split view" : "AI Assistant"}
              disabled={disableAIToggle}
            >
              <Bot className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-auto relative">
        {/* ── Raw Text Mode ── */}
        {viewMode === 'raw' && (
          <textarea
            value={content}
            onChange={(e) => {
              onChangeContent(e.target.value);
              checkWikilinkQuery(e.currentTarget);
            }}
            onClick={(e) => checkWikilinkQuery(e.currentTarget)}
            onKeyUp={(e) => checkWikilinkQuery(e.currentTarget)}
            onKeyDown={(e) => handleAutocompleteKeyDown(e)}
            placeholder="Raw markdown source..."
            className="w-full h-full p-4 md:p-8 bg-transparent resize-none focus:outline-none text-base md:text-lg leading-relaxed font-mono text-gray-300"
            spellCheck={false}
            readOnly={readOnly}
          />
        )}

        {/* ── Live Preview Block Editor ── */}
        {viewMode === 'live' && (
          <div className="w-full h-full p-4 md:p-8 overflow-y-auto prose prose-invert prose-lg max-w-none prose-headings:font-bold prose-h1:text-3xl prose-a:text-obsidian-accent prose-code:text-pink-500 prose-pre:bg-obsidian-sidebar prose-pre:border prose-pre:border-obsidian-border pb-32">
            {blocks.map((block, idx) => (
              <div key={idx} className="relative block-markdown-container mb-2 group min-h-[1.5em]">
                {activeBlockIndex === idx ? (
                  <>
                    <textarea
                      id={`block-textarea-${idx}`}
                      value={block}
                      onChange={(e) => {
                        handleBlockChange(idx, e.target.value);
                        checkWikilinkQuery(e.currentTarget);
                      }}
                      onInput={(e) => {
                        e.currentTarget.style.height = 'auto';
                        e.currentTarget.style.height = `${e.currentTarget.scrollHeight}px`;
                      }}
                      onBlur={() => {
                        if (isOverSuggestionsRef.current) return;
                        setTimeout(() => setActiveBlockIndex(null), 150);
                      }}
                      onKeyDown={(e) => {
                        const handled = handleAutocompleteKeyDown(e);
                        if (!handled) handleBlockKeyDown(e, idx);
                      }}
                      onClick={(e) => checkWikilinkQuery(e.currentTarget)}
                      onKeyUp={(e) => checkWikilinkQuery(e.currentTarget)}
                      className="w-full bg-transparent resize-none focus:outline-none text-base md:text-lg leading-relaxed font-mono text-gray-300 overflow-hidden"
                      spellCheck={false}
                      readOnly={readOnly}
                    />
                    {/* Visual tooltip cue when editing a block */}
                    <div className="absolute -bottom-5 right-2 text-[10px] text-gray-500 bg-obsidian-bg/90 px-2 py-1 rounded border border-white/5 opacity-80 pointer-events-none z-10 whitespace-nowrap shadow-sm">
                      <span className="font-bold text-gray-400">{keybindSplitBlock}</span> to split · <span className="font-bold text-gray-400">{keybindNewLine}</span> for newline
                    </div>
                  </>
                ) : (
                  <div
                    className={`min-h-[1.5em] cursor-text rounded-lg transition-all ${readOnly ? '' : 'hover:bg-white/[0.02] p-1 -mx-1'}`}
                    onClick={(e) => {
                      if (readOnly) return;
                      const target = e.target as HTMLElement;
                      if (target.tagName === 'A' || target.tagName === 'INPUT' || target.closest('a') || target.closest('input')) {
                        return;
                      }
                      setActiveBlockIndex(idx);
                    }}
                  >
                    {!block.trim() ? (
                      <div className="h-[1.5em] w-full" />
                    ) : (
                      <ReactMarkdown 
                        remarkPlugins={[remarkGfm]}
                        components={{
                          input: ({ node, ...props }) => {
                            if (props.type === 'checkbox') {
                              return (
                                <input
                                  {...props}
                                  disabled={false}
                                  className="cursor-pointer appearance-none w-4 h-4 rounded border-2 border-obsidian-border bg-transparent checked:bg-obsidian-accent checked:border-obsidian-accent relative flex-shrink-0 transition-all checked:after:content-['✓'] checked:after:text-white checked:after:absolute checked:after:-top-1 checked:after:left-[1px] checked:after:text-xs"
                                  onChange={(e) => {
                                    const container = e.target.closest('.block-markdown-container');
                                    if (container) {
                                      const checkboxes = Array.from(container.querySelectorAll('input[type="checkbox"]'));
                                      const checkboxIndex = checkboxes.indexOf(e.target);
                                      if (checkboxIndex !== -1) {
                                        handleCheckboxToggle(idx, checkboxIndex);
                                      }
                                    }
                                  }}
                                />
                              );
                            }
                            return <input {...props} />;
                          }
                        }}
                      >
                        {block}
                      </ReactMarkdown>
                    )}
                  </div>
                )}
              </div>
            ))}
            {/* Invisible spacer at bottom to click and create a new block */}
            {!readOnly && (
              <div 
                className="h-32 w-full cursor-text"
                onClick={() => {
                  if (blocks[blocks.length - 1] === '') {
                    setActiveBlockIndex(blocks.length - 1);
                  } else {
                    const newBlocks = [...blocks, ''];
                    setBlocks(newBlocks);
                    const newContent = newBlocks.join('\n\n');
                    setLastPropagatedContent(newContent);
                    onChangeContent(newContent);
                    setActiveBlockIndex(newBlocks.length - 1);
                  }
                }}
              />
            )}
          </div>
        )}

        {/* ── Autocomplete Suggestions Dropdown ── */}
        {suggestionsOpen && filteredSuggestions.length > 0 && (
          <div
            onMouseEnter={() => { isOverSuggestionsRef.current = true; }}
            onMouseLeave={() => { isOverSuggestionsRef.current = false; }}
            className="absolute z-50 bg-obsidian-sidebar/95 backdrop-blur-md border border-white/10 rounded-lg shadow-[0_10px_25px_-5px_rgba(0,0,0,0.5),0_8px_10px_-6px_rgba(0,0,0,0.5)] flex flex-col p-1 min-w-[180px] max-w-[300px] max-h-[200px] overflow-y-auto animate-in fade-in slide-in-from-top-2 duration-150"
            style={{
              top: suggestionsCoords.top,
              left: suggestionsCoords.left,
            }}
          >
            {filteredSuggestions.map((suggestion, idx) => (
              <div
                key={suggestion}
                onClick={() => handleSelectNote(suggestion)}
                className={`
                  px-3 py-2 text-sm rounded cursor-pointer transition-colors break-words
                  ${idx === selectedSuggestionIndex ? 'bg-obsidian-accent text-white font-medium shadow-sm' : 'text-gray-300 hover:bg-white/10'}
                `}
              >
                {suggestion}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default MarkdownEditor;