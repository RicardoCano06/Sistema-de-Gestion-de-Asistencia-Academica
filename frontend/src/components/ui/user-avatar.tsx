import { cn } from '@/lib/utils';

/** Avatar con iniciales para cuando no hay foto disponible */
interface UserAvatarProps {
  nombres?: string;
  apellidos?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

function getInitials(nombres?: string, apellidos?: string): string {
  const firstInitial = (nombres ?? '').trim().charAt(0).toUpperCase();
  const lastInitial = (apellidos ?? '').trim().charAt(0).toUpperCase();
  return `${firstInitial}${lastInitial}` || '??';
}

/** Paleta de colores deterministas basada en las iniciales */
function getAvatarColor(initials: string): string {
  const colors = [
    'bg-sky-600/80',
    'bg-violet-600/80',
    'bg-emerald-600/80',
    'bg-amber-600/80',
    'bg-rose-600/80',
    'bg-indigo-600/80',
    'bg-teal-600/80',
    'bg-cyan-600/80',
  ];
  const code = initials.charCodeAt(0) + (initials.charCodeAt(1) || 0);
  return colors[code % colors.length];
}

const SIZE_CLASSES = {
  sm: 'size-8 text-xs',
  md: 'size-10 text-sm',
  lg: 'size-14 text-lg',
};

export function UserAvatar({ nombres, apellidos, size = 'md', className }: UserAvatarProps) {
  const initials = getInitials(nombres, apellidos);
  const colorClass = getAvatarColor(initials);

  return (
    <div
      aria-label={`Avatar de ${nombres ?? ''} ${apellidos ?? ''}`.trim()}
      className={cn(
        'rounded-full flex items-center justify-center font-semibold text-[#f0f4f8] shrink-0 select-none',
        SIZE_CLASSES[size],
        colorClass,
        className
      )}
    >
      {initials}
    </div>
  );
}
