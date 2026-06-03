import { useAuth } from '../../../services/auth';
import { Navigate } from 'react-router-dom';
import PageVisibilitySection from './PageVisibilitySection';
import TableDefaultsSection from './TableDefaultsSection';
import ModeratorsSection from './ModeratorsSection';
import CustomAccountSection from './CustomAccountSection';

export default function AccessSettings() {
  const { isOwner } = useAuth();

  if (!isOwner) return <Navigate to="/login" replace />;

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-white">Доступи</h1>
      <PageVisibilitySection />
      <TableDefaultsSection />
      <ModeratorsSection />
      <CustomAccountSection />
    </div>
  );
}
