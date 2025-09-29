import { Sidebar } from '@/components/layout/Sidebar';
import { TimelineView } from '@/components/planning/TimelineView';

const Index = () => {
  return (
    <div className="flex h-screen w-full bg-background">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <TimelineView />
      </div>
    </div>
  );
};

export default Index;
