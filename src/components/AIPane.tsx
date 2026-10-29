import React, { useState, useRef, useEffect } from 'react';
import { User, Note } from '../types';
import * as db from '../services/storage';
import { X, Send, Bot, User as UserIcon, Loader2, PlusCircle, Check, Undo2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface AIPaneProps {
  user: User;
  note: Note | undefined;
  onClose: () => void;
  onAppendContent: (content: string) => void;
  onUpdateNote: (title: string | null, content: string | null) => void;
}

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

const AIPane: React.FC<AIPaneProps> = ({ user, note, onClose, onAppendContent, onUpdateNote }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState('');
  const [streamingRawContent, setStreamingRawContent] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Endpoint/model/key come from the server when the panel opens; the key is not kept in the profile.
  const [aiConfig, setAiConfig] = useState<db.AiConfig | null>(null);
  const [configError, setConfigError] = useState('');
  useEffect(() => {
    let cancelled = false;
    db.fetchAiConfig(user.id)
      .then(c => { if (!cancelled) setAiConfig(c); })
      .catch(e => { if (!cancelled) setConfigError(e.message || 'Could not load AI settings'); });
    return () => { cancelled = true; };
  }, [user.id, user.aiEndpoint, user.aiModel, user.hasAiApiKey]);

  // Model edits to the note are proposals: nothing changes until the user applies it, and an applied
  // change can be undone. (A note can contain text written by anyone in the vault, so a prompt injection
  // must not be able to rewrite the note silently.)
  const [proposal, setProposal] = useState<{ noteId: string; title: string | null; content: string | null } | null>(null);
  useEffect(() => { setProposal(null); }, [note?.id]); // a proposal belongs to the note it was made for
  const [undoSnapshot, setUndoSnapshot] = useState<{ noteId: string; title: string; content: string } | null>(null);

  const MessageBubble = ({ msg, onAppendContent, isStreaming }: { msg: Message, onAppendContent: (content: string) => void, isStreaming?: boolean }) => {
    const [thinkingExpanded, setThinkingExpanded] = useState(false);
    let thinkText: string | null = null;
    let actualContent = msg.content;

    const thinkMatch = msg.content.match(/<think>([\s\S]*?)(?:<\/think>|$)/);
    if (thinkMatch) {
      thinkText = thinkMatch[1].trim();
      actualContent = msg.content.replace(/<think>[\s\S]*?(?:<\/think>|$)/, '').trim();
    }

    return (
      <div className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
        <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${msg.role === 'user' ? 'bg-obsidian-accent/20 text-obsidian-accent' : 'bg-emerald-500/20 text-emerald-400'}`}>
          {msg.role === 'user' ? <UserIcon className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
        </div>
        <div className={`flex flex-col gap-1 max-w-[85%] ${msg.role === 'user' ? 'items-end' : 'items-start'} overflow-hidden`}>
          
          {thinkText !== null && (
            <div className="w-full mb-1">
               <button 
                 onClick={() => setThinkingExpanded(!thinkingExpanded)}
                 className="bg-white/5 border border-white/10 rounded-2xl rounded-tl-sm px-4 py-3 text-sm flex items-center gap-3 cursor-pointer hover:bg-white/10 transition-colors shadow-sm"
               >
                  {msg.content.includes('</think>') ? (
                      <>
                          <Bot className="w-4 h-4 text-obsidian-accent" />
                          <span className="text-gray-400 font-semibold text-xs uppercase tracking-wider">Thought Process</span>
                      </>
                  ) : (
                      <>
                          <div className="flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-obsidian-accent animate-bounce"></span>
                            <span className="w-1.5 h-1.5 rounded-full bg-obsidian-accent animate-bounce" style={{ animationDelay: '0.2s' }}></span>
                            <span className="w-1.5 h-1.5 rounded-full bg-obsidian-accent animate-bounce" style={{ animationDelay: '0.4s' }}></span>
                          </div>
                          <span className="text-gray-400 font-semibold text-xs uppercase tracking-wider ml-1">AI is thinking</span>
                      </>
                  )}
               </button>
               {thinkingExpanded && (
                 <div className="mt-2 bg-black/30 border border-white/5 rounded-xl p-3 text-xs text-gray-400 font-mono overflow-x-auto whitespace-pre-wrap max-h-60">
                   {thinkText || "..."}
                 </div>
               )}
            </div>
          )}

          {(actualContent || (!thinkText && isStreaming)) && (
             <div className={`px-4 py-2 text-sm overflow-x-auto shadow-md ${msg.role === 'user' ? 'bg-obsidian-accent text-white rounded-2xl rounded-tr-sm' : 'bg-white/10 text-gray-200 border border-white/5 rounded-2xl rounded-tl-sm w-full'}`}>
                {!actualContent && isStreaming ? (
                   <div className="flex items-center gap-1 h-5 px-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-bounce"></span>
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-bounce" style={{ animationDelay: '0.2s' }}></span>
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-bounce" style={{ animationDelay: '0.4s' }}></span>
                   </div>
                ) : (
                   <div className="prose prose-invert prose-sm max-w-none prose-p:leading-relaxed prose-pre:bg-black/50 prose-pre:border prose-pre:border-white/10 prose-p:last:mb-0 prose-p:first:mt-0 relative">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {actualContent + (isStreaming ? ' ▍' : '')}
                      </ReactMarkdown>
                   </div>
                )}
             </div>
          )}
          {msg.role === 'assistant' && actualContent && !isStreaming && (
            <button 
              onClick={() => onAppendContent(actualContent)}
              className="flex items-center gap-1 mt-1 text-[10px] uppercase font-bold tracking-wider text-gray-400 hover:text-obsidian-accent transition-colors px-1"
              title="Append this to your open note"
            >
              <PlusCircle className="w-3 h-3" /> Append to Note
            </button>
          )}
        </div>
      </div>
    );
  };

  const aiEndpoint = aiConfig?.aiEndpoint?.replace(/\/$/, '');
  const isConfigured = !!(aiEndpoint && aiConfig?.aiModel);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || !isConfigured) return;

    const userMessage: Message = { role: 'user', content: input };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput('');
    setLoading(true);
    setIsConnecting(true);
    setError('');

    try {
      // Build context from current note
      const systemMessage: Message = {
        role: 'system',
        content: `You are an AI assistant integrated into a markdown notes app. The user is currently viewing a note titled "${note?.title || 'Untitled'}". Note content:\n\n${note?.content || '(Empty)'}\n\nProvide helpful, markdown-formatted responses. If the user asks you to write something for the note, provide it clearly so they can append it. You also have a tool to update the note's title and content directly if the user requests it.`
      };

      const tools = [
        {
          type: "function",
          function: {
            name: "update_note",
            description: "Updates the current note's title and/or content. Use this tool when the user asks you to modify, rewrite, or append to the note. To append, include the original content followed by the new content.",
            parameters: {
              type: "object",
              properties: {
                title: { type: "string", description: "The new title of the note." },
                content: { type: "string", description: "The entire new content of the note." }
              }
            }
          }
        }
      ];

      const response = await fetch(`${aiEndpoint}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(aiConfig?.aiApiKey ? { 'Authorization': `Bearer ${aiConfig.aiApiKey}` } : {})
        },
        body: JSON.stringify({
          model: aiConfig?.aiModel,
          messages: [systemMessage, ...newMessages.map(m => ({ role: m.role, content: m.content || "" }))],
          tools: tools,
          stream: true
        })
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');
      
      const decoder = new TextDecoder();
      let done = false;
      let rawContent = '';
      let toolCallBuffer = '';
      let currentToolCallName = '';

      setIsConnecting(false);
      
      while (!done) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;
        if (value) {
          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n').filter(line => line.trim() !== '');
          
          for (const line of lines) {
            if (line.replace(/^data: /, '').trim() === '[DONE]') {
              continue;
            }
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.choices && data.choices.length > 0) {
                  const delta = data.choices[0].delta;
                  
                  // Handle Tool Calls
                  if (delta.tool_calls) {
                    const tc = delta.tool_calls[0];
                    if (tc.function?.name) {
                      currentToolCallName = tc.function.name;
                    }
                    if (tc.function?.arguments) {
                      toolCallBuffer += tc.function.arguments;
                    }
                  }
                  
                  // Handle Content
                  if (delta.content) {
                    rawContent += delta.content;
                    setStreamingRawContent(rawContent);
                  }
                }
              } catch (e) {
                // Ignore parse errors for incomplete chunks
              }
            }
          }
        }
      }

      if (currentToolCallName === 'update_note' && toolCallBuffer) {
         try {
           const args = JSON.parse(toolCallBuffer);
           setProposal({
             noteId: note?.id || '',
             title: typeof args.title === 'string' ? args.title : null,
             content: typeof args.content === 'string' ? args.content : null
           });
           if (!rawContent) rawContent = "_The assistant proposed changes to this note. Review them below, then apply or discard._";
         } catch (e) {
           console.error("Failed to parse tool call stream", e);
         }
      }

      setMessages(prev => [...prev, { role: 'assistant', content: rawContent }]);
      setStreamingRawContent('');
    } catch (e: any) {
      setError(e.message || 'Failed to communicate with AI');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-obsidian-sidebar border-l border-obsidian-border/50 shadow-2xl relative">
      <div className="flex justify-between items-center p-3 border-b border-obsidian-border/50 bg-black/20">
        <div className="flex items-center gap-2 text-obsidian-accent">
          <Bot className="w-5 h-5" />
          <h3 className="font-bold text-sm">AI Assistant</h3>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      {!isConfigured ? (
        <div className="flex-1 flex items-center justify-center p-6 text-center">
          <div className="bg-white/5 border border-white/10 rounded-xl p-5 max-w-sm">
            <Bot className="w-10 h-10 text-gray-500 mx-auto mb-3" />
            <h4 className="font-bold text-white mb-2">{!aiConfig && !configError ? 'Loading…' : 'AI Not Configured'}</h4>
            <p className="text-sm text-gray-400">
              {configError || 'Please configure your OpenAI-compatible endpoint and model in Account Settings to use the AI assistant.'}
            </p>
          </div>
        </div>
      ) : (
        <>
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.length === 0 ? (
              <div className="text-center text-sm text-gray-500 mt-10">
                Ask a question about your note or prompt the AI to generate content.
              </div>
            ) : (
              messages.map((msg, idx) => (
                <MessageBubble key={idx} msg={msg} onAppendContent={onAppendContent} />
              ))
            )}
            {streamingRawContent && (
               <MessageBubble 
                  msg={{ role: 'assistant', content: streamingRawContent }} 
                  onAppendContent={onAppendContent} 
                  isStreaming={true} 
               />
            )}
            {isConnecting && (
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
                  <Bot className="w-4 h-4" />
                </div>
                <div className="bg-white/10 px-4 py-3 rounded-2xl rounded-tl-sm flex items-center gap-2">
                  <Loader2 className="w-4 h-4 text-emerald-400 animate-spin" />
                  <span className="text-gray-400 text-xs uppercase tracking-wider font-semibold">Connecting...</span>
                </div>
              </div>
            )}
            {loading && !isConnecting && !streamingRawContent && (
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
                  <Bot className="w-4 h-4" />
                </div>
                <div className="bg-white/10 px-4 py-3 rounded-2xl rounded-tl-sm flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce"></span>
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '0.2s' }}></span>
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '0.4s' }}></span>
                </div>
              </div>
            )}
            {error && (
              <div className="bg-red-900/20 border border-red-500/30 text-red-400 text-xs p-3 rounded-xl text-center">
                {error}
              </div>
            )}
            {proposal && note && proposal.noteId === note.id && (
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 text-xs space-y-2">
                <div className="font-bold text-amber-300">The assistant wants to change this note</div>
                {proposal.title !== null && proposal.title !== note.title && (
                  <div className="text-gray-300"><span className="text-gray-500">Title:</span> “{note.title}” → “{proposal.title}”</div>
                )}
                {proposal.content !== null && proposal.content !== note.content && (
                  <>
                    <div className="text-gray-500">New content ({proposal.content.length.toLocaleString()} characters, was {note.content.length.toLocaleString()}):</div>
                    <pre className="max-h-40 overflow-auto whitespace-pre-wrap bg-black/30 rounded p-2 text-gray-200">{proposal.content.slice(0, 2000)}{proposal.content.length > 2000 ? '\n…' : ''}</pre>
                  </>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setUndoSnapshot({ noteId: note.id, title: note.title, content: note.content });
                      onUpdateNote(proposal.title, proposal.content);
                      setProposal(null);
                    }}
                    className="flex items-center gap-1 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-semibold"
                  ><Check className="w-3 h-3" /> Apply</button>
                  <button onClick={() => setProposal(null)} className="px-3 py-1.5 bg-white/10 hover:bg-white/20 text-gray-300 rounded-lg">Discard</button>
                </div>
              </div>
            )}
            {undoSnapshot && note && undoSnapshot.noteId === note.id && !proposal && (
              <div className="flex items-center justify-between bg-white/5 border border-white/10 rounded-xl p-2 text-xs text-gray-300">
                <span>AI changes were applied to this note.</span>
                <button
                  onClick={() => { onUpdateNote(undoSnapshot.title, undoSnapshot.content); setUndoSnapshot(null); }}
                  className="flex items-center gap-1 px-2 py-1 bg-white/10 hover:bg-white/20 rounded-lg"
                ><Undo2 className="w-3 h-3" /> Undo</button>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="p-3 bg-black/10 border-t border-obsidian-border/50">
            <div className="flex items-end gap-2 bg-obsidian-bg/50 border border-obsidian-border/50 rounded-xl p-1 focus-within:border-obsidian-accent focus-within:ring-1 focus-within:ring-obsidian-accent transition-all shadow-inner">
              <textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder="Ask AI..."
                className="flex-1 bg-transparent border-none text-white text-sm p-2 max-h-32 min-h-[40px] resize-none focus:outline-none placeholder-gray-500"
                rows={1}
              />
              <button 
                onClick={handleSend}
                disabled={!input.trim() || loading}
                className="p-2 mb-1 mr-1 bg-obsidian-accent text-white rounded-lg hover:bg-opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </button>
            </div>
            <div className="text-center mt-2">
              <span className="text-[10px] text-gray-500">Shift+Enter for newline</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default AIPane;
