import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { PlanDetailClient } from "@/components/plan-client";

export const metadata = { title: "Game plan" };

export default async function PlanPage({ params }: { params: Promise<{ planSlug: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/");
  const { planSlug } = await params;
  return <PlanDetailClient slug={planSlug} />;
}
