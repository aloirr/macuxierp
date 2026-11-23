'use client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { colunasDeErros, textoDeConfirmacaoCargaCompleta } from '@macuxierp/integracao-fdv/web';
import type { EntidadeHub } from '@macuxierp/integracao-fdv/contracts';
import { paraCsv } from '@macuxierp/platform-sdk/listas';
import type { VistaIntegracaoFdv as Vista } from '@/lib/integracao-fdv';
import { agirIntegracaoFdv, type PedidoIntegracaoFdv, type ResultadoIntegracaoFdv } from '@/app/(shell)/[modulo]/[...pagina]/acoes-integracao-fdv';
import { baixarCsv } from '@/lib/baixar-csv';
import { mensagemDaFalha } from '@/lib/sistema-atualizado';
import { VistaIntegracaoFdv } from './vista';

/** Estado e chamadas da tela. A chave do conector fica só no campo do formulário até o envio: sem estado, URL ou armazenamento. */
export function TelaIntegracaoFdvCliente({ vista }: { vista: Vista }) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const [ocupado, setOcupado] = useState(false);
  const [mensagem, setMensagem] = useState<{ ok: boolean; texto: string } | null>(null);
  const [erros, setErros] = useState<Record<string, string>>({});

  async function enviar(p: PedidoIntegracaoFdv): Promise<ResultadoIntegracaoFdv> {
    setOcupado(true);
    setErros({});
    try {
      const r = await agirIntegracaoFdv(p);
      setMensagem({ ok: r.ok, texto: r.mensagem });
      setErros(r.erros ?? {});
      if (r.ok || r.recarregar) iniciar(() => router.refresh()); // recarrega o monitor
      return r;
    } catch (e) {
      setMensagem({ ok: false, texto: mensagemDaFalha(e) });
      return { ok: false, mensagem: '' };
    } finally {
      setOcupado(false);
    }
  }

  return (
    <VistaIntegracaoFdv
      vista={vista}
      estado={{ ocupado: ocupado || pendente, mensagem, erros }}
      acoes={{
        testar: () => void enviar({ tipo: 'testar' }),
        tentarDeNovo: (entidades) => void enviar({ tipo: 'retomar', entidades }),
        cargaCompleta: (entidade) => {
          if (window.confirm(textoDeConfirmacaoCargaCompleta(entidade as EntidadeHub))) void enviar({ tipo: 'carga', entidade });
        },
        exportarErros: () => baixarCsv('erros-integracao-fdv.csv', paraCsv(colunasDeErros, vista.erros)),
        salvarCredencial: async (f) => {
          const d = new FormData(f);
          const r = await enviar({ tipo: 'credencial', conector_id: String(d.get('conector_id') ?? ''), chave: String(d.get('chave') ?? ''), ambiente: String(d.get('ambiente') ?? '') });
          return r.ok;
        },
        salvarConfiguracao: (f) => {
          const d = new FormData(f);
          void enviar({ tipo: 'configuracao', entidades_habilitadas: d.getAll('entidades').map(String), limite_registros_lote: String(d.get('limite') ?? '') });
        },
      }}
    />
  );
}
