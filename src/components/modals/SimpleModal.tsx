import React, { useState, useEffect, useRef } from 'react';
import { X } from 'lucide-react';

interface SimpleModalProps {
  isOpen: boolean;
  title: string;
  initialValue?: string;
  placeholder?: string;
  onClose: () => void;
  onConfirm: (value: string) => void;
}

const SimpleModal: React.FC<SimpleModalProps> = ({ isOpen, title, initialValue = '', placeholder = '', onClose, onConfirm }) => {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setValue(initialValue);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen, initialValue]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-obsidian-sidebar/80 backdrop-blur-2xl border border-obsidian-border/50 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden transform transition-all scale-100">
        <div className="flex justify-between items-center p-4 border-b border-obsidian-border/50 bg-white/5">
            <h3 className="text-lg font-bold text-white shadow-sm">{title}</h3>
            <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6">
            <input 
              ref={inputRef}
              className="w-full bg-obsidian-bg/50 border border-obsidian-border/50 rounded-lg p-3 text-white mb-6 focus:border-obsidian-accent focus:outline-none placeholder-gray-500 shadow-inner"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={placeholder}
              onKeyDown={(e) => {
                 if (e.key === 'Enter') onConfirm(value);
                 if (e.key === 'Escape') onClose();
              }}
            />
            <div className="flex justify-end space-x-3">
              <button onClick={onClose} className="px-4 py-2 rounded text-sm text-gray-400 hover:text-white hover:bg-white/5 transition">Cancel</button>
              <button 
                onClick={() => onConfirm(value)} 
                disabled={!value.trim()}
                className="px-4 py-2 bg-obsidian-accent text-white rounded text-sm font-bold hover:bg-opacity-90 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Confirm
              </button>
            </div>
        </div>
      </div>
    </div>
  );
};

export default SimpleModal;
