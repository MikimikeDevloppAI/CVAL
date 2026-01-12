import { OptimizePlanningDialog } from '@/components/planning/OptimizePlanningDialog';

const PlanifierPage = () => {
  return (
    <div className="w-full">
      <OptimizePlanningDialog open={true} onOpenChange={() => {}} embedded />
    </div>
  );
};

export default PlanifierPage;
