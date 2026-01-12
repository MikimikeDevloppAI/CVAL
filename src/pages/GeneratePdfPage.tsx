import { GeneratePdfDialog } from '@/components/dashboard/GeneratePdfDialog';

const GeneratePdfPage = () => {
  return (
    <div className="w-full">
      <GeneratePdfDialog open={true} onOpenChange={() => {}} embedded />
    </div>
  );
};

export default GeneratePdfPage;
