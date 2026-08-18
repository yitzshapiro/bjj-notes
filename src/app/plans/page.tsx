import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { PlansClient } from "@/components/plan-client";

export const metadata = { title: "Game plans" };

export default async function PlansPage() {
  const session = await auth();
  if (!session?.user) redirect("/");
  return <PlansClient />;
}
