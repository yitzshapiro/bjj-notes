import { redirect } from "next/navigation";

import { StudyClient } from "@/components/study-client";
import { AuthRequiredError, requireAuth } from "@/lib/auth-guard";
import { assertActiveVideo, GoogleDriveError } from "@/lib/drive";
import { createPlaybackToken } from "@/lib/playback-token";

export default async function VideoStudyPage({
  params,
  searchParams,
}: {
  params: Promise<{ videoId: string }>;
  searchParams: Promise<{ t?: string }>;
}) {
  const { videoId } = await params;
  const { t } = await searchParams;
  let video: Awaited<ReturnType<typeof assertActiveVideo>>;

  try {
    await requireAuth();
    video = await assertActiveVideo(videoId);
  } catch (error) {
    if (error instanceof AuthRequiredError) redirect("/");
    if (error instanceof GoogleDriveError && error.status === 404) redirect("/library");
    throw error;
  }

  const version = String(video.driveModifiedAt?.getTime() ?? video.updatedAt.getTime());
  const playbackToken = createPlaybackToken({
    videoId: video.id,
    sizeBytes: video.sizeBytes,
    version,
  });

  return (
    <StudyClient
      videoId={video.id}
      initialName={video.name}
      initialDuration={video.durationMs ? video.durationMs / 1000 : 0}
      initialSeek={Math.max(0, Number(t) || 0)}
      playbackToken={playbackToken}
      streamVersion={version}
    />
  );
}
