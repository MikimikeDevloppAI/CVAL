import { 
  Calendar, 
  LayoutDashboard, 
  Users, 
  Building2, 
  Clock, 
  BarChart3,
  UserPlus,
  Settings
} from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';

const navigation = [
  { name: 'Vue d\'ensemble', href: '/', icon: LayoutDashboard },
  { name: 'Planning', href: '/', icon: Calendar },
  { name: 'Médecins', href: '/medecins', icon: Users },
  { name: 'Secrétaires', href: '/secretaires', icon: UserPlus },
  { name: 'Sites', href: '#', icon: Building2 },
  { name: 'Horaires', href: '#', icon: Clock },
  { name: 'Statistiques', href: '#', icon: BarChart3 },
  { name: 'Paramètres', href: '#', icon: Settings },
];

export const Sidebar = () => {
  const location = useLocation();

  return (
    <div className="flex h-full w-64 flex-col bg-white border-r border-border">
      {/* Logo */}
      <div className="flex h-16 shrink-0 items-center px-6 border-b border-border">
        <div className="flex items-center space-x-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
            <Calendar className="h-4 w-4 text-white" />
          </div>
          <span className="text-lg font-semibold text-foreground">Calendar</span>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex flex-1 flex-col px-3 py-4">
        <ul role="list" className="flex flex-1 flex-col gap-y-1">
          {navigation.map((item) => {
            const isActive = location.pathname === item.href;
            return (
              <li key={item.name}>
                <Link
                  to={item.href}
                  className={cn(
                    'group flex gap-x-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-primary text-white'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                  )}
                >
                  <item.icon
                    className={cn(
                      'h-4 w-4 shrink-0 transition-colors',
                      isActive ? 'text-white' : 'text-muted-foreground group-hover:text-foreground'
                    )}
                  />
                  {item.name}
                </Link>
              </li>
            );
          })}
        </ul>

        {/* Brand section */}
        <div className="mt-6 rounded-lg bg-muted p-4">
          <div className="flex items-center justify-center">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-orange-100">
              <span className="text-lg">🌟</span>
            </div>
            <span className="ml-2 text-sm font-medium text-foreground">Odyssey</span>
          </div>
        </div>
      </nav>
    </div>
  );
};