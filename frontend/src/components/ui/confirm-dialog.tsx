import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './dialog';

interface ConfirmDialogProps {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'default';
  loading?: boolean;
}

export function ConfirmDialog({
  open,
  onCancel,
  onConfirm,
  title,
  description,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  variant = 'default',
  loading = false,
}: ConfirmDialogProps) {
  const confirmClasses =
    variant === 'danger'
      ? 'btn-modern btn-modern-danger'
      : variant === 'warning'
        ? 'btn-modern btn-modern-warning'
        : 'btn-modern btn-modern-primary';

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onCancel(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <DialogFooter className="btn-mobile-stack mt-4 flex flex-row justify-end gap-3 max-lg:mt-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="btn-modern btn-modern-ghost max-lg:w-full"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={`${confirmClasses} max-lg:w-full`}
          >
            {loading ? 'Procesando...' : confirmLabel}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
