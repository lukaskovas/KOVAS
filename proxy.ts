import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Bramka wejściowa: odświeża sesję Supabase (tokeny wygasają co godzinę) i odsyła
 * niezalogowanych na /login. To pierwsza warstwa - właściwe sprawdzenie uprawnień
 * robi requireUser()/requireAdmin() z lib/auth.ts na każdej stronie.
 */

export async function proxy(request: NextRequest) {
  // Endpoint crona ma własną autoryzację (CRON_SECRET) i wołany jest bez sesji przez Vercel Cron -
  // gdyby przechodził przez bramkę sesyjną, zostałby odbity na /login i sync nigdy by się nie wykonał.
  if (request.nextUrl.pathname.startsWith("/api/cron")) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          for (const { name, value } of list) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of list) response.cookies.set(name, value, options);
        },
      },
    },
  );

  const { data } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isLogin = path === "/login";

  if (!data.user && !isLogin) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    // Po zalogowaniu wracamy tam, gdzie użytkownik chciał wejść
    url.search = path === "/" ? "" : `?next=${encodeURIComponent(path + request.nextUrl.search)}`;
    return NextResponse.redirect(url);
  }

  if (data.user && isLogin) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  // Wszystko poza zasobami statycznymi Next.js i favicon
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
