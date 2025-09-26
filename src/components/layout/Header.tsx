import { Search, Bell, ChevronDown, Filter } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { doctors, secretaries } from '@/data/mockData';

const allUsers = [...doctors, ...secretaries];

export const Header = () => {
  return (
    <header className="flex h-16 items-center justify-between bg-white px-6">
      {/* Left section - Title and user info */}
      <div className="flex items-center space-x-4">
        <div className="flex items-center space-x-3">
          <img
            src="https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=32&h=32&fit=crop&crop=face"
            alt="John Anders"
            className="h-8 w-8 rounded-full object-cover"
          />
          <span className="text-sm font-medium text-foreground">John Anders</span>
        </div>
        <h1 className="text-xl font-semibold text-foreground ml-8">Clinique La Vallée</h1>
      </div>

      {/* Right section - User avatars */}
      <div className="flex items-center space-x-3">
        <div className="flex -space-x-2">
          {allUsers.slice(0, 4).map((user, index) => (
            <div
              key={user.id}
              className="relative h-8 w-8 rounded-full border-2 border-white shadow-subtle"
              style={{ zIndex: 4 - index }}
            >
              <img
                src={user.avatar}
                alt={`${user.firstName} ${user.lastName}`}
                className="h-full w-full rounded-full object-cover"
              />
            </div>
          ))}
          {allUsers.length > 4 && (
            <div className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-muted text-xs font-medium text-muted-foreground shadow-subtle">
              +{allUsers.length - 4}
            </div>
          )}
        </div>
      </div>
    </header>
  );
};