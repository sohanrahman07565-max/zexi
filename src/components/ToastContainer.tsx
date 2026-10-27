import React, { useState, useEffect } from 'react';
import { toast, ToastItem } from '../lib/toast';
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from 'lucide-react';

export const ToastContainer: React.FC = () => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    const unsubscribe = toast.subscribe((updated) => {
      setToasts(updated);
    });
    return unsubscribe;
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div 
      aria-live="polite"
      className="fixed top-3.5 sm:top-5 inset-x-0 z-[9999] flex flex-col items-center pointer-events-none px-3.5 sm:px-4 gap-2.5 max-w-md mx-auto"
    >
      {toasts.map((item) => {
        const isSuccess = item.type === 'success';
        const isError = item.type === 'error';
        const isWarning = item.type === 'warning';

        return (
          <div
            key={item.id}
            role="alert"
            className={`pointer-events-auto w-full rounded-2xl p-3.5 sm:p-4 backdrop-blur-2xl border shadow-2xl flex items-start gap-3 transition-all duration-300 ease-out animate-in slide-in-from-top-4 fade-in duration-300 ${
              isSuccess
                ? 'bg-[#06140f]/95 border-emerald-500/40 text-emerald-200 shadow-[0_12px_40px_rgba(0,0,0,0.85),0_0_24px_rgba(16,185,129,0.28)]'
                : isError
                ? 'bg-[#18080f]/95 border-rose-500/50 text-rose-200 shadow-[0_12px_40px_rgba(0,0,0,0.85),0_0_24px_rgba(244,63,94,0.32)]'
                : isWarning
                ? 'bg-[#181206]/95 border-amber-500/45 text-amber-200 shadow-[0_12px_40px_rgba(0,0,0,0.85),0_0_24px_rgba(245,158,11,0.25)]'
                : 'bg-[#0a0f1d]/95 border-blue-500/45 text-blue-200 shadow-[0_12px_40px_rgba(0,0,0,0.85),0_0_24px_rgba(59,130,246,0.25)]'
            }`}
          >
            {/* Status Icon with ambient glow */}
            <div className="shrink-0 mt-0.5">
              {isSuccess && (
                <div className="w-6 h-6 rounded-full bg-emerald-500/20 border border-emerald-400/40 flex items-center justify-center text-emerald-400 shadow-xs">
                  <CheckCircle2 className="w-4 h-4" />
                </div>
              )}
              {isError && (
                <div className="w-6 h-6 rounded-full bg-rose-500/20 border border-rose-400/40 flex items-center justify-center text-rose-400 shadow-xs">
                  <AlertCircle className="w-4 h-4" />
                </div>
              )}
              {isWarning && (
                <div className="w-6 h-6 rounded-full bg-amber-500/20 border border-amber-400/40 flex items-center justify-center text-amber-400 shadow-xs">
                  <AlertTriangle className="w-4 h-4" />
                </div>
              )}
              {!isSuccess && !isError && !isWarning && (
                <div className="w-6 h-6 rounded-full bg-blue-500/20 border border-blue-400/40 flex items-center justify-center text-blue-400 shadow-xs">
                  <Info className="w-4 h-4" />
                </div>
              )}
            </div>

            {/* Content Text */}
            <div className="flex-1 min-w-0 pr-1">
              {item.title && (
                <div className="text-xs font-bold text-white tracking-tight mb-0.5">
                  {item.title}
                </div>
              )}
              <div className="text-xs font-medium leading-relaxed break-words">
                {item.message}
              </div>
            </div>

            {/* Close Button */}
            <button
              type="button"
              onClick={() => toast.dismiss(item.id)}
              className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer shrink-0 -mr-1 -mt-1"
              aria-label="Dismiss notification"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
};
