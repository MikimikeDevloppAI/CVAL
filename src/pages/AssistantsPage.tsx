import { SecretairesPopup } from '@/components/dashboard/secretaires/SecretairesPopup';

const AssistantsPage = () => {
  return (
    <div className="w-full">
      <SecretairesPopup open={true} onOpenChange={() => {}} embedded />
    </div>
  );
};

export default AssistantsPage;
