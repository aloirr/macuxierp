/**
 * Cliente tipado da API do core para o BKO. A resposta é validada pelo mesmo Zod de `contracts`; o token e o `fetch`
 * entram por injeção. Segredos (senha do A1, senha provisória) nunca ficam em estado: o formulário limpa o campo e a
 * senha provisória é "consumida" uma vez (`SenhaUmaVez`).
 */
import { z } from 'zod';
import {
  Empresa,
  Exportacao,
  ListaAmbientes,
  ListaAuditoria,
  ListaCertificados,
  ListaUsuarios,
  CertificadoResumo,
  AmbienteFiscal,
  Licenca,
  PerfilComAcoes,
  SenhaProvisoria,
  UsuarioComSenhaProvisoria,
  type CertificadoEnviar,
  type UsuarioCriar,
} from '../contracts';
import { paraQuery } from '@macuxierp/platform-sdk/listas';

export class ErroCliente extends Error {
  override readonly name = 'ErroCliente';
  constructor(
    readonly status: number,
    readonly codigo: string,
    mensagem: string,
  ) {
    super(mensagem);
  }
}

export type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string | FormData }) => Promise<{ status: number; json(): Promise<unknown> }>;

const Itens = <T extends z.ZodTypeAny>(t: T) => z.object({ itens: z.array(t) });

export function criarClienteCore(cfg: { baseUrl: string; token: () => string; fetch: Fetch }) {
  async function chamar<T>(metodo: string, caminho: string, schema: z.ZodType<T, z.ZodTypeDef, unknown> | null, corpo?: unknown): Promise<T> {
    // FormData (multipart): o `Content-Type` com a fronteira é do fetch; não se define aqui.
    const formulario = typeof FormData !== 'undefined' && corpo instanceof FormData;
    const r = await cfg.fetch(`${cfg.baseUrl}/v1/core${caminho}`, {
      method: metodo,
      headers: { Authorization: `Bearer ${cfg.token()}`, ...(corpo === undefined || formulario ? {} : { 'Content-Type': 'application/json' }) },
      body: corpo === undefined ? undefined : formulario ? (corpo as FormData) : JSON.stringify(corpo),
    });
    if (r.status === 204 || schema === null) return undefined as T;
    const json = await r.json();
    if (r.status >= 400) {
      const e = z.object({ codigo: z.string(), mensagem: z.string() }).safeParse(json);
      throw new ErroCliente(r.status, e.success ? e.data.codigo : 'ERRO', e.success ? e.data.mensagem : 'Erro inesperado');
    }
    return schema.parse(json);
  }

  const q = (f: Record<string, string | undefined> = {}) => paraQuery(f);
  return {
    empresa: () => chamar('GET', '/empresa', Empresa),
    usuarios: (f?: Record<string, string>) => chamar('GET', `/usuarios${q(f)}`, ListaUsuarios),
    criarUsuario: (c: UsuarioCriar) => chamar('POST', '/usuarios', UsuarioComSenhaProvisoria, c),
    inativarUsuario: (id: string) => chamar('DELETE', `/usuarios/${id}`, null),
    redefinirSenha: (id: string) => chamar('POST', `/usuarios/${id}/redefinir-senha`, SenhaProvisoria, {}),
    perfis: () => chamar('GET', '/perfis', Itens(PerfilComAcoes)),
    licencas: () => chamar('GET', '/licencas', Itens(Licenca)),
    certificados: (filialId?: string) => chamar('GET', `/certificados${q({ filial_id: filialId })}`, ListaCertificados),
    /** Multipart: `arquivo` é o `.pfx` (até 50 KB); a senha vai como campo de texto e nunca é guardada aqui. */
    enviarCertificado: (c: CertificadoEnviar, arquivo: Blob) => {
      const f = new FormData();
      f.set('filial_id', c.filial_id);
      f.set('senha', c.senha);
      f.set('arquivo', arquivo, 'certificado.pfx');
      return chamar('POST', '/certificados', CertificadoResumo, f);
    },
    ambientes: (filialId?: string) => chamar('GET', `/ambientes-fiscais${q({ filial_id: filialId })}`, ListaAmbientes),
    trocarAmbiente: (filialId: string, ambiente: 'homologacao' | 'producao', recado: string | null) =>
      chamar('PUT', `/ambientes-fiscais/${filialId}`, AmbienteFiscal, { ambiente, recado_aprovacao: recado }),
    auditoria: (f?: Record<string, string>) => chamar('GET', `/auditoria${q(f)}`, ListaAuditoria),
    pedirExportacao: () => chamar('POST', '/exportacoes', Exportacao, {}),
    exportacao: (id: string) => chamar('GET', `/exportacoes/${id}`, Exportacao),
  };
}

/** Guarda um valor que só pode ser lido uma vez (senha provisória): depois de `consumir`, some da memória. */
export class SenhaUmaVez {
  private valor: string | null;
  constructor(valor: string) {
    this.valor = valor;
  }
  consumir(): string | null {
    const v = this.valor;
    this.valor = null;
    return v;
  }
  toJSON(): string {
    return '[oculta]';
  }
}
