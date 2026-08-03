import { toast as sonnerToast } from 'sonner';

function hashMsg(message: string): string {
  let hash = 0;
  for (let i = 0; i < message.length; i++) {
    const char = message.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return `toast-${hash}`;
}

type ToastOptions = { id?: string; duration?: number; [key: string]: unknown };

export const toast = {
  error(message: string, options?: ToastOptions) {
    sonnerToast.error(message, { id: options?.id ?? hashMsg(message), ...options });
  },
  success(message: string, options?: ToastOptions) {
    sonnerToast.success(message, { id: options?.id ?? hashMsg(message), ...options });
  },
  warning(message: string, options?: ToastOptions) {
    sonnerToast.warning(message, { id: options?.id ?? hashMsg(message), ...options });
  },
  info(message: string, options?: ToastOptions) {
    sonnerToast.info(message, { id: options?.id ?? hashMsg(message), ...options });
  },
};
