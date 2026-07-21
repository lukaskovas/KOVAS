import LoginForm from "./login-form";

export const metadata = { title: "Kovas · Logowanie" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;

  return (
    <div className="flex min-h-full items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="font-display text-2xl font-bold uppercase tracking-[0.2em] text-plum">Kovas</div>
          <div className="font-display mt-1 text-xs uppercase tracking-widest text-plum-light">
            Raporty (Turis + wFirma)
          </div>
        </div>

        <div className="border-2 border-gold bg-white p-6">
          <LoginForm next={next} />
        </div>

        <p className="mt-6 text-center text-xs text-plum-light">
          Nie masz dostępu? Poproś administratora o założenie konta.
        </p>
      </div>
    </div>
  );
}
