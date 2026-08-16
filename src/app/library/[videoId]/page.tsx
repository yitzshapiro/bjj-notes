import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { StudyClient } from "@/components/study-client";

export default async function VideoStudyPage({
  params,
  searchParams,
}: {
  params: Promise<{ videoId: string }>;
  searchParams: Promise<{ name?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/");
  const [{ videoId }, query] = await Promise.all([params, searchParams]);
  return <StudyClient videoId={videoId} initialName={query.name ?? "Instructional video"} />;
}
