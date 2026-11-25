import { tratarZerarPedidos } from '@/lib/config/pedidos-zerar-rotas';

/** Zerar pedidos não faturados (T-0093): só o superadmin (cookie `mx_config`); a API confere de novo a frase "autorizo zerar os dados". */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return tratarZerarPedidos(req, (await params).id);
}
