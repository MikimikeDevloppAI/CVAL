import { LucideIcon } from 'lucide-react';
import { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  icon?: LucideIcon;
  action?: ReactNode;
}

export function PageHeader({ title, icon: Icon, action }: PageHeaderProps) {
  return (
    <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-primary/10 via-primary/5 to-background border border-primary/20 backdrop-blur-sm">
      <div className="absolute inset-0 bg-grid-white/10 [mask-image:radial-gradient(white,transparent_85%)]" />
      <div className="relative px-6 py-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            {Icon && (
              <div className="p-3 rounded-xl bg-primary/10 border border-primary/20">
                <Icon className="h-7 w-7 text-primary" />
              </div>
            )}
            <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-br from-foreground to-foreground/70 bg-clip-text text-transparent">
              {title}
            </h1>
          </div>
          {action && (
            <div className="flex items-center gap-2">
              {action}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
