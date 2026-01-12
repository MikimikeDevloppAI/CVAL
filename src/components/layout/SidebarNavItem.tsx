import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface SidebarNavItemProps {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  badge?: number;
  gradient?: string;
}

export function SidebarNavItem({ icon, label, onClick, badge, gradient }: SidebarNavItemProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium",
        "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-primary-foreground",
        "transition-all duration-200"
      )}
    >
      <div className={cn(
        "p-2 rounded-lg transition-transform duration-200 group-hover:scale-110",
        gradient ? `bg-gradient-to-br ${gradient}` : "bg-sidebar-accent"
      )}>
        <div className="text-white">
          {icon}
        </div>
      </div>
      <span className="flex-1 text-left">{label}</span>
      {badge !== undefined && badge > 0 && (
        <Badge variant="destructive" className="h-5 min-w-5 px-1.5 text-xs">
          {badge}
        </Badge>
      )}
    </button>
  );
}
