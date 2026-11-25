import { tratarPreviaZerarPedidos } from '@/lib/config/pedidos-zerar-rotas';

/** Prévia do Zerar pedidos não faturados (T-0093): POST sem corpo, só leitura. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return tratarPreviaZerarPedidos(req, (await params).id);
}
