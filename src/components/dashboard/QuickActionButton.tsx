import { useNavigate } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface QuickActionButtonProps {
  label: string;
  icon: React.ReactNode;
  href?: string;
  onClick?: () => void;
  gradient: string;
  count?: number;
}

export const QuickActionButton = ({ label, icon, href, onClick, gradient, count }: QuickActionButtonProps) => {
  const navigate = useNavigate();

  const handleClick = () => {
    if (onClick) {
      onClick();
    } else if (href) {
      navigate(href);
    }
  };

  return (
    <button
      onClick={handleClick}
      className={cn(
        "group relative overflow-hidden rounded-xl p-4",
        "bg-card/50 backdrop-blur-xl border border-border/50",
        "shadow-lg hover:shadow-xl",
        "transition-all duration-300 ease-out",
        "focus:outline-none focus:ring-2 focus:ring-primary/50",
        "min-h-[80px]"
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

      <div className="relative flex items-start gap-4">
        {/* Icon with Gradient */}
        <div
          className={cn(
            "p-3 rounded-lg bg-gradient-to-br shadow-lg flex-shrink-0",
            "transition-transform duration-300 group-hover:scale-110",
            gradient
          )}
        >
          <div className="text-white">
            {icon}
          </div>
        </div>

        <div className="flex-1 min-w-0 flex flex-col justify-between">
          {/* Label */}
          <p className="text-sm font-medium text-foreground break-words whitespace-normal leading-tight">
            {label}
          </p>
          
          {/* Count info and badge */}
          {count !== undefined && count > 0 && (
            <div className="flex items-center gap-2 mt-2">
              <p className="text-xs text-muted-foreground">
                {count} {count > 1 ? 'éléments' : 'élément'}
              </p>
              <Badge
                variant="secondary"
                className="font-semibold"
              >
                {count}
              </Badge>
            </div>
          )}
        </div>
      </div>
    </button>
  );
};
