import { LucideIcon } from 'lucide-react';
import { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  icon?: LucideIcon;
  action?: ReactNode;
}

export function PageHeader({ title, icon: Icon, action }: PageHeaderProps) {
  return (
    <div className="flex items-center justify-between py-6">
      <div className="flex items-center gap-4">
        {Icon && (
          <div className="p-2.5 rounded-lg bg-primary/10">
            <Icon className="h-6 w-6 text-primary" />
          </div>
        )}
        <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-primary via-primary/80 to-primary/60 bg-clip-text text-transparent">
          {title}
        </h1>
      </div>
      {action && (
        <div className="flex items-center gap-2">
          {action}
        </div>
      )}
    </div>
  );
}
