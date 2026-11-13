import { FamilyTutor } from '@/components/tutor/family-tutor';

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ thread?: string }>;
}) {
  const { thread } = await searchParams;
  return <FamilyTutor initialThread={thread} key={thread || 'home'} />;
}
