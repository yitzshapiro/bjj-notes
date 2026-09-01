import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { CaptionsClient } from "@/components/captions-client";

export default async function CaptionsPage() {
  const session = await auth();
  if (!session?.user) redirect("/");
  return <CaptionsClient />;
}
