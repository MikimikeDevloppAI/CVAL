import { GlobalCalendarDialog } from '@/components/dashboard/GlobalCalendarDialog';

const CalendrierGlobalPage = () => {
  return (
    <div className="w-full">
      <GlobalCalendarDialog open={true} onOpenChange={() => {}} embedded />
    </div>
  );
};

export default CalendrierGlobalPage;
