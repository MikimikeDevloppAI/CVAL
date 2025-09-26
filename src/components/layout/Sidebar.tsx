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
import { cn } from '@/lib/utils';

const navigation = [
  { name: 'Vue d\'ensemble', href: '#', icon: LayoutDashboard, current: false },
  { name: 'Planning', href: '#', icon: Calendar, current: true },
  { name: 'Médecins', href: '#', icon: Users, current: false },
  { name: 'Secrétaires', href: '#', icon: UserPlus, current: false },
  { name: 'Sites', href: '#', icon: Building2, current: false },
  { name: 'Horaires', href: '#', icon: Clock, current: false },
  { name: 'Statistiques', href: '#', icon: BarChart3, current: false },
  { name: 'Paramètres', href: '#', icon: Settings, current: false },
];

export const Sidebar = () => {
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
          {navigation.map((item) => (
            <li key={item.name}>
              <a
                href={item.href}
                className={cn(
                  'group flex gap-x-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  item.current
                    ? 'bg-primary text-white'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                )}
              >
                <item.icon
                  className={cn(
                    'h-4 w-4 shrink-0 transition-colors',
                    item.current ? 'text-white' : 'text-muted-foreground group-hover:text-foreground'
                  )}
                />
                {item.name}
              </a>
            </li>
          ))}
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