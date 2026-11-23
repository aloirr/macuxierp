import { tratarZerar } from '@/lib/config/cargas-rotas';

/** Zerar dados da empresa (T-0058): só o superadmin (cookie `mx_config`); a API confere o código da empresa de novo. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return tratarZerar(req, (await params).id);
}
