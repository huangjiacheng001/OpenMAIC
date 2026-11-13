import { HomeworkReview } from '@/components/tutor/homework-review';

export default async function PracticePage({
  searchParams,
}: {
  searchParams: Promise<{ item?: string; done?: string }>;
}) {
  const { item, done } = await searchParams;
  return <HomeworkReview itemId={item} initialDone={done === '1'} />;
}
