import { cn } from '@/lib/utils';

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {}

export function Skeleton({ className, ...props }: SkeletonProps) {
  return (
    <div
      className={cn('animate-pulse rounded-md bg-white/5', className)}
      {...props}
    />
  );
}

/** Fila de skeleton para listas/tablas */
export function SkeletonRow({ cols = 4, className }: { cols?: number; className?: string }) {
  return (
    <div className={cn('flex items-center gap-3 px-4 py-3', className)}>
      <Skeleton className="size-9 rounded-full shrink-0" />
      {Array.from({ length: cols - 1 }).map((_, i) => (
        <Skeleton key={i} className={`h-4 rounded flex-1 ${i === 0 ? 'max-w-[180px]' : i === cols - 2 ? 'max-w-[100px]' : ''}`} />
      ))}
    </div>
  );
}

/** Skeleton para un detalle/panel lateral */
export function SkeletonDetail() {
  return (
    <div className="flex flex-col gap-4 p-5">
      <div className="flex items-center gap-4">
        <Skeleton className="size-14 rounded-full" />
        <div className="flex flex-col gap-2 flex-1">
          <Skeleton className="h-5 w-40 rounded" />
          <Skeleton className="h-3.5 w-24 rounded" />
        </div>
      </div>
      <Skeleton className="h-px w-full" />
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex flex-col gap-1.5">
          <Skeleton className="h-3 w-20 rounded" />
          <Skeleton className="h-9 w-full rounded" />
        </div>
      ))}
    </div>
  );
}

/** Skeleton para cards en grid */
export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={cn('bg-[#172d58] border border-[#223c49] rounded-xl p-4 flex flex-col gap-3', className)}>
      <Skeleton className="h-4 w-3/4 rounded" />
      <Skeleton className="h-3 w-1/2 rounded" />
      <Skeleton className="h-px w-full" />
      <Skeleton className="h-3 w-full rounded" />
      <Skeleton className="h-3 w-5/6 rounded" />
    </div>
  );
}
