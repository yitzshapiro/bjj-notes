import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { HistoryClient } from "@/components/history-client";

export const metadata = { title: "History" };

export default async function HistoryPage() {
  const session = await auth();
  if (!session?.user) redirect("/");
  return <HistoryClient />;
}
