import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { DivisionsClient } from "@/components/divisions-client";

export const metadata = { title: "Divisions" };

export default async function DivisionsPage() {
  const session = await auth();
  if (!session?.user) redirect("/");
  return <DivisionsClient />;
}
