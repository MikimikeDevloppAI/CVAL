import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface UnfilledNeedsBadgeProps {
  count: number;
  onClick: () => void;
  isLoading: boolean;
}

export const UnfilledNeedsBadge = ({ count, onClick, isLoading }: UnfilledNeedsBadgeProps) => {
  if (count === 0 && !isLoading) return null;

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onClick}
      disabled={isLoading}
      className={cn(
        "mb-4 h-8 gap-2 text-xs transition-all duration-300",
        count > 0 && "border-destructive/50 bg-gradient-to-r from-orange-500/10 to-destructive/10 hover:from-orange-500/20 hover:to-destructive/20"
      )}
    >
      <AlertCircle className="h-3.5 w-3.5 text-destructive" />
      <span className="font-medium">
        {isLoading ? (
          "Chargement..."
        ) : (
          <>
            <span className="font-bold text-destructive">{count}</span> besoin{count > 1 ? 's' : ''} non satisfait{count > 1 ? 's' : ''} (4 semaines)
          </>
        )}
      </span>
    </Button>
  );
};
