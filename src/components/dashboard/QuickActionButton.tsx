import { useNavigate } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface QuickActionButtonProps {
  label: string;
  icon: React.ReactNode;
  href: string;
  gradient: string;
  count?: number;
}

export const QuickActionButton = ({ label, icon, href, gradient, count }: QuickActionButtonProps) => {
  const navigate = useNavigate();

  return (
    <button
      onClick={() => navigate(href)}
      className={cn(
        "group relative overflow-hidden rounded-xl p-6",
        "bg-card/50 backdrop-blur-xl border border-border/50",
        "shadow-lg hover:shadow-2xl",
        "transition-all duration-300 ease-out",
        "hover:scale-105 hover:-translate-y-1",
        "focus:outline-none focus:ring-2 focus:ring-primary/50"
      )}
    >
      {/* Gradient Background on Hover */}
      <div
        className={cn(
          "absolute inset-0 opacity-0 group-hover:opacity-10",
          "transition-opacity duration-300",
          `bg-gradient-to-br ${gradient}`
        )}
      />

      <div className="relative flex items-center justify-between">
        <div className="flex items-center gap-4">
          {/* Icon with Gradient */}
          <div
            className={cn(
              "p-3 rounded-lg bg-gradient-to-br shadow-lg",
              "transition-transform duration-300 group-hover:scale-110",
              gradient
            )}
          >
            <div className="text-white">
              {icon}
            </div>
          </div>

          {/* Label */}
          <div className="text-left">
            <p className="text-sm font-medium text-foreground">
              {label}
            </p>
            {count !== undefined && count > 0 && (
              <p className="text-xs text-muted-foreground mt-1">
                {count} {count > 1 ? 'éléments' : 'élément'}
              </p>
            )}
          </div>
        </div>

        {/* Count Badge */}
        {count !== undefined && count > 0 && (
          <Badge
            variant="secondary"
            className="ml-2 font-semibold"
          >
            {count}
          </Badge>
        )}
      </div>
    </button>
  );
};
