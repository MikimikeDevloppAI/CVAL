import { Search, Bell, ChevronDown, Filter } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { doctors, secretaries } from '@/data/mockData';

const allUsers = [...doctors, ...secretaries];

export const Header = () => {
  return (
    <header className="flex h-16 items-center justify-between border-b bg-white px-6">
      {/* Left section - Title */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Planning</h1>
      </div>

      {/* Center section - Search */}
      <div className="flex flex-1 max-w-md mx-8">
        <div className="relative w-full">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Rechercher un médecin, rendez-vous..."
            className="pl-10 pr-4 border-0 bg-muted/50 focus:bg-white focus:shadow-soft transition-all"
          />
        </div>
      </div>

      {/* Right section - User avatars and notifications */}
      <div className="flex items-center space-x-4">
        {/* Filter button */}
        <Button variant="outline" size="sm" className="gap-2">
          <Filter className="h-4 w-4" />
          Filtrer
          <ChevronDown className="h-4 w-4" />
        </Button>

        {/* User avatars */}
        <div className="flex items-center space-x-2">
          <div className="flex -space-x-2">
            {allUsers.slice(0, 4).map((user, index) => (
              <div
                key={user.id}
                className="relative h-8 w-8 rounded-full border-2 border-white shadow-sm"
                style={{ zIndex: 4 - index }}
              >
                <img
                  src={user.avatar}
                  alt={`${user.firstName} ${user.lastName}`}
                  className="h-full w-full rounded-full object-cover"
                />
                <div className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white bg-success"></div>
              </div>
            ))}
            {allUsers.length > 4 && (
              <div className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-muted text-xs font-medium text-muted-foreground">
                +{allUsers.length - 4}
              </div>
            )}
          </div>
        </div>

        {/* Notifications */}
        <div className="relative">
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
            <Bell className="h-4 w-4" />
          </Button>
          <Badge className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-destructive p-0 text-[10px] text-white">
            3
          </Badge>
        </div>
      </div>
    </header>
  );
};