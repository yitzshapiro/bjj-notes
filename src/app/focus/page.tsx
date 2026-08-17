import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { FocusClient } from "@/components/focus-client";

export const metadata = { title: "Focus" };

export default async function FocusPage() {
  const session = await auth();
  if (!session?.user) redirect("/");
  return <FocusClient />;
}
