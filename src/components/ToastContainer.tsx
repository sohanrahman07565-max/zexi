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
            className={`glass pointer-events-auto w-full rounded-[22px] p-3.5 sm:p-4 flex items-start gap-3 transition-all duration-300 ease-out animate-in slide-in-from-top-4 fade-in duration-300 ${
              isSuccess
                ? 'text-emerald-200 border-emerald-400/35'
                : isError
                ? 'text-rose-200 border-rose-400/40'
                : isWarning
                ? 'text-amber-200 border-amber-400/40'
                : 'text-sky-200 border-sky-400/40'
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
