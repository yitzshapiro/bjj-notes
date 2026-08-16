import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import type { JWT } from "next-auth/jwt";

const DRIVE_READONLY_SCOPE = "https://www.googleapis.com/auth/drive.readonly";

function allowedEmail() {
  return process.env.ALLOWED_GOOGLE_EMAIL?.trim().toLowerCase();
}

async function refreshGoogleAccessToken(token: JWT): Promise<JWT> {
  if (!token.googleRefreshToken) {
    return { ...token, googleTokenError: "RefreshAccessTokenError" };
  }

  try {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.AUTH_GOOGLE_ID ?? "",
        client_secret: process.env.AUTH_GOOGLE_SECRET ?? "",
        grant_type: "refresh_token",
        refresh_token: token.googleRefreshToken,
      }),
      cache: "no-store",
    });

    const refreshed = (await response.json()) as {
      access_token?: string;
      expires_in?: number;
      refresh_token?: string;
      error?: string;
      error_description?: string;
    };

    if (!response.ok || !refreshed.access_token) {
      throw new Error(refreshed.error_description ?? refreshed.error ?? "Google token refresh failed");
    }

    return {
      ...token,
      googleAccessToken: refreshed.access_token,
      googleAccessTokenExpiresAt: Date.now() + (refreshed.expires_in ?? 3600) * 1000,
      googleRefreshToken: refreshed.refresh_token ?? token.googleRefreshToken,
      googleTokenError: undefined,
    };
  } catch (error) {
    console.error("Unable to refresh the Google access token", error);
    return { ...token, googleTokenError: "RefreshAccessTokenError" };
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  session: { strategy: "jwt" },
  providers: [
    Google({
      authorization: {
        params: {
          scope: `openid email profile ${DRIVE_READONLY_SCOPE}`,
          access_type: "offline",
          prompt: "consent",
        },
      },
    }),
  ],
  callbacks: {
    signIn({ user, profile }) {
      const expected = allowedEmail();
      const email = user.email?.trim().toLowerCase();
      const emailVerified = profile && "email_verified" in profile ? profile.email_verified !== false : true;
      return Boolean(expected && email && email === expected && emailVerified);
    },
    async jwt({ token, account }) {
      if (account) {
        return {
          ...token,
          googleAccessToken: account.access_token,
          googleRefreshToken: account.refresh_token ?? token.googleRefreshToken,
          googleAccessTokenExpiresAt: account.expires_at
            ? account.expires_at * 1000
            : Date.now() + 3600 * 1000,
          googleTokenError: undefined,
        };
      }

      if (
        token.googleAccessToken &&
        token.googleAccessTokenExpiresAt &&
        Date.now() < token.googleAccessTokenExpiresAt - 60_000
      ) {
        return token;
      }

      return refreshGoogleAccessToken(token);
    },
    session({ session, token }) {
      session.tokenError = token.googleTokenError;
      return session;
    },
  },
});

export { refreshGoogleAccessToken };
