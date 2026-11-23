import { tratarCarga } from '@/lib/config/cargas-rotas';

/** Ponte do navegador para as rotas de carga da plataforma (T-0058): validar e gravar (POST), erros.csv e modelo (GET). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string; cadastro: string; acao: string }> }) {
  const { id, cadastro, acao } = await params;
  return tratarCarga(req, id, cadastro, acao);
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string; cadastro: string; acao: string }> }) {
  const { id, cadastro, acao } = await params;
  return tratarCarga(req, id, cadastro, acao);
}
