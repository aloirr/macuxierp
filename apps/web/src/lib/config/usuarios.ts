import { ROTULOS_ACAO_USUARIO, ROTULOS_SITUACAO_USUARIO, ROTULO_ULTIMO_ADMIN, type AcaoUsuario, type FilialConfig, type UsuarioConfig } from '@macuxierp/core/contracts';
import { semAcento } from '../texto-busca';
import { tomAmarelo } from '../usuarios-textos';
import { TOM_SITUACAO_USUARIO } from '@macuxierp/core/web';
import { ROTULOS_PERFIL, formatarDataHora, type Perfil } from '@macuxierp/platform-sdk';

/**
 * Tabela Usuários da Config (v0.3.29, RN-CORE-01, RN-CORE-17). A tela NÃO recalcula regra: o menu "Ações ▾" é exatamente `acoes[]`
 * da linha (já na ordem) e a etiqueta vem de `ultimo_admin_ativo`. Aqui só o que é apresentação.
 */
export interface ItemMenuUsuario {
  chave: AcaoUsuario;
  rotulo: string;
  /** Só o Excluir: depois do separador, em vermelho. */
  perigo: boolean;
}

export const itensDoMenuUsuario = (u: Pick<UsuarioConfig, 'acoes'>): ItemMenuUsuario[] =>
  u.acoes.map((chave) => ({ chave, rotulo: ROTULOS_ACAO_USUARIO[chave], perigo: chave === 'excluir' }));

/** Selo da situação; `tom` já no vocabulário do `Chip` (o contrato chama o amarelo de 'alerta'). */
export const seloDoUsuario = (u: Pick<UsuarioConfig, 'situacao'>): { texto: string; tom: 'sucesso' | 'aviso' | 'neutro' } => {
  const t = TOM_SITUACAO_USUARIO[u.situacao];
  return { texto: ROTULOS_SITUACAO_USUARIO[u.situacao], tom: t === 'ok' ? 'sucesso' : tomAmarelo(t) };
};

export const etiquetaUltimoAdmin = (u: Pick<UsuarioConfig, 'ultimo_admin_ativo'>): string | null => (u.ultimo_admin_ativo ? ROTULO_ULTIMO_ADMIN : null);

export const rotuloPerfil = (p: Perfil): string => ROTULOS_PERFIL[p];

export const textoUltimoAcesso = (u: Pick<UsuarioConfig, 'ultimo_acesso_em' | 'deve_trocar_senha'>, fuso: string): string =>
  u.ultimo_acesso_em ? formatarDataHora(u.ultimo_acesso_em, fuso) : u.deve_trocar_senha ? 'Ainda não entrou' : '—';

/** Busca por nome ou e-mail (mascarado, o único que a tela tem), sem acento nem caixa. */
export const filtrarUsuarios = (itens: readonly UsuarioConfig[], busca: string): UsuarioConfig[] => {
  const b = semAcento(busca);
  return b === '' ? [...itens] : itens.filter((u) => semAcento(`${u.nome} ${u.email_mascarado}`).includes(b));
};

/** T-0130: filiais marcadas ao abrir o formulário. Usuário novo: só a padrão. Edição: as do usuário que a empresa ainda lista. */
export const filiaisIniciais = (filiais: readonly FilialConfig[], atuais: readonly string[] | null): string[] =>
  atuais === null ? filiais.filter((f) => f.padrao).map((f) => f.id) : filiais.filter((f) => atuais.includes(f.id)).map((f) => f.id);

/** Marca ou desmarca uma filial, mantendo a ordem da lista da empresa. */
export const alternarFilial = (filiais: readonly FilialConfig[], marcadas: readonly string[], id: string, marcar: boolean): string[] =>
  filiais.filter((f) => (f.id === id ? marcar : marcadas.includes(f.id))).map((f) => f.id);

export const mesmasFiliais = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x) => b.includes(x));
