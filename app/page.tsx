import { FamilyTutor } from '@/components/tutor/family-tutor';

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ thread?: string; exchange?: string }>;
}) {
  const { thread, exchange } = await searchParams;
  return <FamilyTutor initialThread={thread} initialExchange={exchange} key={thread || 'home'} />;
}
