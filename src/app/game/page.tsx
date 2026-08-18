import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { GameClient } from "@/components/game-client";

export const metadata = { title: "My Game" };

export default async function GamePage() {
  const session = await auth();
  if (!session?.user) redirect("/");
  return <GameClient />;
}
