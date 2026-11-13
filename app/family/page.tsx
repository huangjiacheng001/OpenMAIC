import { FamilyProfile } from '@/components/tutor/family-profile';

export default async function FamilyPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  return (
    <FamilyProfile start={(await searchParams).view === 'profiles' ? 'profiles' : 'records'} />
  );
}
