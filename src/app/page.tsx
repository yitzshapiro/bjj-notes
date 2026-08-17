import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";
import { BookOpen, LockKeyhole } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";

export default async function HomePage() {
  const session = await auth();
  if (session?.user) redirect("/library");

  return (
    <main className="signin-page">
      <ThemeToggle className="signin-theme-toggle" />
      <section className="signin-card">
        <span className="brand__mark"><BookOpen size={20} strokeWidth={2.4} /></span>
        <h1>BJJ Notes</h1>
        <p>Private BJJ video notes.</p>
        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: "/library" });
          }}
        >
          <button className="button button--primary button--large button--full" type="submit">
            <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M21.6 12.23c0-.71-.06-1.4-.18-2.07H12v3.91h5.38a4.6 4.6 0 0 1-1.99 3.02v2.54h3.23c1.89-1.74 2.98-4.3 2.98-7.4Z"/><path fill="currentColor" opacity=".72" d="M12 22c2.7 0 4.96-.9 6.62-2.42l-3.23-2.5c-.9.6-2.04.96-3.39.96-2.6 0-4.8-1.76-5.6-4.12H3.06v2.58A10 10 0 0 0 12 22Z"/><path fill="currentColor" opacity=".5" d="M6.4 13.92A6.02 6.02 0 0 1 6.08 12c0-.67.12-1.32.32-1.92V7.5H3.06A10 10 0 0 0 2 12c0 1.61.39 3.14 1.06 4.5l3.34-2.58Z"/><path fill="currentColor" opacity=".86" d="M12 5.96c1.47 0 2.78.5 3.82 1.49l2.87-2.87A9.64 9.64 0 0 0 12 2a10 10 0 0 0-8.94 5.5l3.34 2.58c.8-2.36 3-4.12 5.6-4.12Z"/></svg>
            Continue with Google
          </button>
        </form>
        <small><LockKeyhole size={13} /> Restricted account</small>
      </section>
    </main>
  );
}
