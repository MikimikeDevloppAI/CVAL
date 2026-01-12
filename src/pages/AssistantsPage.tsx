import { SecretairesPopup } from '@/components/dashboard/secretaires/SecretairesPopup';

const AssistantsPage = () => {
  return (
    <div className="w-full h-full p-4 lg:p-6">
      <SecretairesPopup open={true} onOpenChange={() => {}} embedded />
    </div>
  );
};

export default AssistantsPage;
