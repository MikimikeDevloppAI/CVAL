import { OperationsPopup } from '@/components/dashboard/operations/OperationsPopup';

const OperationsPage = () => {
  return (
    <div className="w-full">
      <OperationsPopup open={true} onOpenChange={() => {}} embedded />
    </div>
  );
};

export default OperationsPage;
