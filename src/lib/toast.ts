export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface ToastItem {
  id: string;
  type: ToastType;
  title?: string;
  message: string;
  duration?: number;
}

type ToastListener = (toasts: ToastItem[]) => void;

class ToastManager {
  private toasts: ToastItem[] = [];
  private listeners: Set<ToastListener> = new Set();

  subscribe(listener: ToastListener) {
    this.listeners.add(listener);
    listener([...this.toasts]);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    this.listeners.forEach((l) => l([...this.toasts]));
  }

  show(item: Omit<ToastItem, 'id'> & { id?: string }) {
    const id = item.id || `toast_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const duration = item.duration ?? 4000;
    const newToast: ToastItem = { ...item, id, duration };

    // Keep max 3 toasts visible simultaneously
    this.toasts = [newToast, ...this.toasts.slice(0, 2)];
    this.notify();

    if (duration > 0) {
      setTimeout(() => {
        this.dismiss(id);
      }, duration);
    }
    return id;
  }

  dismiss(id: string) {
    this.toasts = this.toasts.filter((t) => t.id !== id);
    this.notify();
  }

  success(message: string, title?: string, duration?: number) {
    return this.show({ type: 'success', message, title, duration });
  }

  error(message: string, title?: string, duration?: number) {
    return this.show({ type: 'error', message, title, duration });
  }

  info(message: string, title?: string, duration?: number) {
    return this.show({ type: 'info', message, title, duration });
  }

  warning(message: string, title?: string, duration?: number) {
    return this.show({ type: 'warning', message, title, duration });
  }
}

export const toast = new ToastManager();

// Expose globally for convenience if needed
if (typeof window !== 'undefined') {
  (window as any).toast = toast;
}
