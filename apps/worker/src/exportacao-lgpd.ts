/**
 * Exportação dos dados do tenant (LGPD, RF-CORE-06 e RN-CORE-07). A rota `POST /v1/core/exportacoes` grava a
 * `core.exportacao` e enfileira `core.exportar_dados` com `{ exportacao_id }`; este executor junta o JSON de cada módulo
 * num `.zip` em `macuxierp/<tenant>/exportacoes/<id>.zip`, cataloga em `plataforma.arquivo` e marca a exportação pronta.
 *
 * - Idempotente: exportação já pronta não gera de novo; a regravação do mesmo objeto é permitida (não é arquivo fiscal).
 * - Cada módulo exporta o próprio schema pela porta `ExportadorModulo` (fronteira: o worker não lê tabela de módulo).
 * - O conteúdo é dado pessoal: vai só para o arquivo. Resultado do trabalho e log levam só ids, contagens e tamanhos.
 */
import { TRABALHO_EXPORTAR } from '@macuxierp/core/contracts';
import { guardarArquivo, type Armazenamento, type CatalogoArquivos, type ExecutorTrabalho, type ModuloId, type Transacao } from '@macuxierp/platform-sdk';
import { z } from 'zod';
import { criarZip, type EntradaZip } from './zip';

/**
 * Porta de cada módulo: as tabelas dele do tenant da transação (RLS), como linhas JSON.
 * Nunca entram no zip (regras 8 e 9 do CLAUDE.md): hash de senha, refresh token, A1 cifrado e senha do A1. O exportador
 * tira essas colunas na consulta, não depois.
 */
export interface ExportadorModulo {
  modulo: ModuloId;
  exportar(tx: Transacao): Promise<Record<string, readonly unknown[]>>;
}

/** Porta da `core.exportacao` (adaptador do core). */
export interface RegistroExportacoes {
  estado(tx: Transacao, id: string): Promise<'pendente' | 'gerando' | 'pronta' | 'falhou' | 'expirada' | null>;
  concluir(tx: Transacao, id: string, arquivoId: string, agora: Date): Promise<void>;
  falhar(tx: Transacao, id: string, agora: Date): Promise<void>;
}

export interface DependenciasExportacao {
  registro: RegistroExportacoes;
  exportadores: readonly ExportadorModulo[];
  armazenamento: Armazenamento;
  catalogo: CatalogoArquivos;
  agora: () => Date;
}

const Payload = z.object({ exportacao_id: z.string().uuid() });

const json = (v: unknown) => Buffer.from(`${JSON.stringify(v, null, 2)}\n`, 'utf8');

export function criarExecutorExportacao(d: DependenciasExportacao): ExecutorTrabalho {
  const modulos = d.exportadores.map((e) => e.modulo);
  if (new Set(modulos).size !== modulos.length) throw new RangeError('exportação LGPD: exportador repetido por módulo');
  return {
    tipo: TRABALHO_EXPORTAR,
    maxTentativas: 3,
    async executar(trabalho, tx) {
      const { exportacao_id: id } = Payload.parse(trabalho.payload);
      const estado = await d.registro.estado(tx, id);
      if (estado === null) return { exportacao_id: id, estado: 'ausente' };
      if (estado !== 'pendente' && estado !== 'gerando') return { exportacao_id: id, estado };
      const agora = d.agora();
      const entradas: EntradaZip[] = [];
      const linhas: Record<string, number> = {};
      for (const e of d.exportadores) {
        const tabelas = await e.exportar(tx);
        linhas[e.modulo] = Object.values(tabelas).reduce((n, t) => n + t.length, 0);
        entradas.push({ nome: `${e.modulo}.json`, conteudo: json({ modulo: e.modulo, tabelas }) });
      }
      const manifesto = { tenant_id: trabalho.tenant_id, exportacao_id: id, gerado_em: agora.toISOString(), formato: 'json-utf8', modulos, linhas };
      const zip = criarZip([{ nome: 'manifesto.json', conteudo: json(manifesto) }, ...entradas], agora);
      const arquivo = await guardarArquivo({
        armazenamento: d.armazenamento,
        catalogo: d.catalogo,
        tx,
        tenantId: trabalho.tenant_id,
        partes: ['exportacoes', `${id}.zip`],
        corpo: zip,
        tipo: 'application/zip',
        imutavel: false,
        guardaAnos: null,
        agora,
      });
      await d.registro.concluir(tx, id, arquivo.id, agora);
      return { exportacao_id: id, estado: 'pronta', arquivo_id: arquivo.id, bytes: zip.byteLength, linhas };
    },
    async aoDesistir(trabalho, tx) {
      const p = Payload.safeParse(trabalho.payload);
      if (p.success) await d.registro.falhar(tx, p.data.exportacao_id, d.agora());
    },
  };
}
