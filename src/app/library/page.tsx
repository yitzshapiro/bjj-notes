import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { LibraryClient } from "@/components/library-client";

export default async function LibraryPage() {
  const session = await auth();
  if (!session?.user) redirect("/");
  return <LibraryClient />;
}
