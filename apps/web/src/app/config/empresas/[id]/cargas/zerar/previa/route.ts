import { tratarPreviaZerar } from '@/lib/config/cargas-rotas';

/** Prévia do zerar (T-0058): POST, como na API (`zerar/previa`); a API recebe o CSRF do superadmin. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return tratarPreviaZerar(req, (await params).id);
}
