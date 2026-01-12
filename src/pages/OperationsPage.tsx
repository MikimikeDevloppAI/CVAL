import { OperationsPopup } from '@/components/dashboard/operations/OperationsPopup';

const OperationsPage = () => {
  return (
    <div className="w-full h-full p-4 lg:p-6">
      <OperationsPopup open={true} onOpenChange={() => {}} embedded />
    </div>
  );
};

export default OperationsPage;
