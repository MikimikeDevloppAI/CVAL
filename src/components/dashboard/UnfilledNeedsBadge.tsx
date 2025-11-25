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
    <button
      onClick={onClick}
      disabled={isLoading}
      className={cn(
        "ml-2 flex items-center gap-1.5 px-3 py-1.5 rounded-full transition-all duration-300",
        "bg-destructive/10 hover:bg-destructive/20 border border-destructive/30",
        "disabled:opacity-50 disabled:cursor-not-allowed"
      )}
      title={isLoading ? "Chargement..." : `${count} besoin${count > 1 ? 's' : ''} non satisfait${count > 1 ? 's' : ''} sur 4 semaines`}
    >
      <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
      {isLoading ? (
        <span className="text-xs font-medium text-destructive">...</span>
      ) : (
        <span className="text-sm font-bold text-destructive tabular-nums">{count}</span>
      )}
    </button>
  );
};
