import { useState } from 'react';
import { Check, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

interface MultiSelectProps {
  options: { id: string; nom: string }[];
  selected: string[];
  onChange: (selected: string[]) => void;
  placeholder?: string;
}

export function MultiSelect({ options, selected, onChange, placeholder }: MultiSelectProps) {
  const [open, setOpen] = useState(false);

  const handleSelect = (itemId: string) => {
    if (selected.includes(itemId)) {
      onChange(selected.filter(id => id !== itemId));
    } else {
      onChange([...selected, itemId]);
    }
  };

  const selectedItems = options.filter(opt => selected.includes(opt.id));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="w-full justify-start min-h-10">
          {selectedItems.length === 0 && <span className="text-muted-foreground">{placeholder}</span>}
          <div className="flex flex-wrap gap-1">
            {selectedItems.map(item => (
              <Badge key={item.id} variant="secondary" className="gap-1">
                {item.nom}
                <X
                  className="h-3 w-3 cursor-pointer hover:text-destructive"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleSelect(item.id);
                  }}
                />
              </Badge>
            ))}
          </div>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[400px] p-0">
        <Command>
          <CommandInput placeholder="Rechercher..." />
          <CommandEmpty>Aucun résultat trouvé</CommandEmpty>
          <CommandGroup className="max-h-64 overflow-auto">
            {options.map(option => (
              <CommandItem key={option.id} onSelect={() => handleSelect(option.id)}>
                <Check className={cn("mr-2 h-4 w-4", selected.includes(option.id) ? "opacity-100" : "opacity-0")} />
                {option.nom}
              </CommandItem>
            ))}
          </CommandGroup>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
