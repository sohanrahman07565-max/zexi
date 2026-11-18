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
      className="fixed top-[max(0.875rem,env(safe-area-inset-top))] sm:top-[max(1.25rem,env(safe-area-inset-top))] inset-x-0 z-[9999] flex flex-col items-center pointer-events-none px-3.5 sm:px-4 gap-2.5 max-w-md mx-auto"
    >
      {toasts.map((item) => {
        const isSuccess = item.type === 'success';
        const isError = item.type === 'error';
        const isWarning = item.type === 'warning';

        return (
          <div
            key={item.id}
            role="alert"
            className={`lg-toast-card pointer-events-auto w-full rounded-[22px] p-3.5 sm:p-4 flex items-start gap-3 text-white animate-in slide-in-from-top-4 fade-in duration-300 ${
              isSuccess
                ? 'border-emerald-300/50'
                : isError
                ? 'border-rose-300/55'
                : isWarning
                ? 'border-amber-300/50'
                : 'border-purple-200/45'
            }`}
          >
            {/* Status Icon with crisp contrast */}
            <div className="shrink-0 mt-0.5">
              {isSuccess && (
                <div className="w-6 h-6 rounded-full bg-emerald-950/55 border border-emerald-300/50 flex items-center justify-center text-emerald-300 shadow-xs">
                  <CheckCircle2 className="w-4 h-4" />
                </div>
              )}
              {isError && (
                <div className="w-6 h-6 rounded-full bg-rose-950/55 border border-rose-300/50 flex items-center justify-center text-rose-200 shadow-xs">
                  <AlertCircle className="w-4 h-4" />
                </div>
              )}
              {isWarning && (
                <div className="w-6 h-6 rounded-full bg-amber-950/55 border border-amber-300/50 flex items-center justify-center text-amber-200 shadow-xs">
                  <AlertTriangle className="w-4 h-4" />
                </div>
              )}
              {!isSuccess && !isError && !isWarning && (
                <div className="w-6 h-6 rounded-full bg-purple-950/55 border border-purple-200/50 flex items-center justify-center text-purple-100 shadow-xs">
                  <Info className="w-4 h-4" />
                </div>
              )}
            </div>

            {/* Content Text */}
            <div className="flex-1 min-w-0 pr-1">
              {item.title && (
                <div className="text-xs font-bold text-white tracking-tight mb-0.5 drop-shadow-xs">
                  {item.title}
                </div>
              )}
              <div className="text-xs font-medium text-white/95 leading-relaxed break-words drop-shadow-xs">
                {item.message}
              </div>
            </div>

            {/* Close Button */}
            <button
              type="button"
              onClick={() => toast.dismiss(item.id)}
              className="p-1 rounded-lg text-purple-100/80 hover:text-white hover:bg-white/15 transition-colors cursor-pointer shrink-0 -mr-1 -mt-1"
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
