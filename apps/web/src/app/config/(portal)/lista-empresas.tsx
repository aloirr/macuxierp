'use client';
import { formatarDocumento, type EmpresaPlataforma } from '@macuxierp/platform-sdk';
import { DialogoMotivo, MenuAcoes, ResultadoAcao, TabelaDensa, useResultado, type ColunaTabela } from '@macuxierp/ui';
import { resultadoErro } from '@/lib/resultado-acao';
import { acumularPagina } from '@macuxierp/ui/paginacao';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import { ChavesIdempotencia } from '@/lib/config/chaves';
import { AUSENTE, codigoExibido, dataCriacao, filtrarEmpresas, itensAcaoEmpresa, temFdv, type ChaveAcaoEmpresa } from '@/lib/config/empresa';
import { validarMotivo } from '@/lib/config/formularios';
import { modulosLigados, nomeModulo, resumoModulos } from '@/lib/config/modulos';
import { maisEmpresasAcao, redefinirSenhaAdminAcao, situacaoAcao } from '@/lib/acoes-cliente';
import { resultadoSucesso } from '@/lib/resultado-acao';
import { DialogoSenha } from './empresas/[id]/usuarios';
import { SeloSituacao } from './selo-situacao';

/** Acima de 480 px a lista completa; abaixo, "N módulos" (CSS em globals.css). A lista completa fica no title e no aria-label. */
function CelulaModulos({ modulos }: { modulos: EmpresaPlataforma['modulos'] }) {
  const ligados = modulosLigados(modulos);
  if (ligados.length === 0) return <span>{resumoModulos(0)}</span>;
  const lista = ligados.map(nomeModulo).join(' · ');
  return (
    <span title={lista} aria-label={lista} className="modulos-celula">
      <span className="modulos-lista">{lista}</span>
      <span className="modulos-resumo" aria-hidden="true">{resumoModulos(ligados.length)}</span>
    </span>
  );
}

const AVISO_DADO_PESSOAL = 'Não escreva dado pessoal no motivo.';
type Pedido = { chave: ChaveAcaoEmpresa; empresa: EmpresaPlataforma };
type SenhaMostrada = { nome: string; senha: string };

/**
 * Lista de Empresas do /config (simulação aprovada 124 A; RD-2360 a RD-2363): um título só, com a contagem, e a busca única na
 * mesma linha (colunas 1 a 8 e 9 a 12), que filtra ao digitar pelo código ou pelo nome; a tabela na largura toda e, logo abaixo,
 * a barra com "Nova empresa". O Enter manda a busca ao servidor (`?busca=`, por nome e código; 0080). T-0134: coluna "Macuxi FDV"
 * (`tem_fdv`, ausente = Não) e "Ações ▾" por linha (Suspender ou Reativar; Redefinir senha do administrador), sem "Abrir".
 */
export function ListaEmpresas({ empresas, vazio, proximo = null, busca = '' }: { empresas: EmpresaPlataforma[]; vazio: string; proximo?: string | null; busca?: string }) {
  const router = useRouter();
  const [linhas, setLinhas] = useState(empresas);
  const [cursor, setCursor] = useState(proximo);
  const [termo, setTermo] = useState('');
  const [resultado, chaveResultado, mostrar, limpar] = useResultado(); // 36 A: abaixo da tabela, onde fica o "Carregar mais"
  const [pendente, iniciar] = useTransition();
  const [pedido, setPedido] = useState<Pedido | null>(null);
  const [senha, setSenha] = useState<SenhaMostrada | null>(null);
  const chaves = useRef(new ChavesIdempotencia());
  const visiveis = filtrarEmpresas(linhas, termo);
  const carregarMais = () => {
    if (!cursor) return;
    iniciar(async () => {
      const r = await maisEmpresasAcao(busca, cursor);
      if (r.ok) {
        setLinhas((atuais) => acumularPagina(atuais, r.valor.itens, (e) => e.id));
        setCursor(r.valor.proximo_cursor);
        limpar();
      } else {
        mostrar(resultadoErro(r.erro || 'Não foi possível carregar mais. Tente de novo.'));
      }
    });
  };
  const executar = (p: Pedido, motivo: string) => {
    setPedido(null);
    limpar();
    iniciar(async () => {
      const id = `${p.chave}:${p.empresa.id}`;
      if (p.chave === 'redefinir_senha') {
        const r = await redefinirSenhaAdminAcao(p.empresa.id, chaves.current.de(id));
        chaves.current.aposResposta(id, r);
        if (!r.ok) return mostrar(resultadoErro(r.erro || 'Não foi possível redefinir a senha. Tente de novo.'));
        return setSenha({ nome: p.empresa.nome, senha: r.valor.senha_provisoria });
      }
      const suspender = p.chave === 'suspender';
      const r = await situacaoAcao(p.empresa.id, suspender ? 'suspenso' : 'ativo', motivo, chaves.current.de(id));
      chaves.current.aposResposta(id, r);
      if (!r.ok) return mostrar(resultadoErro(r.erro || r.campos.motivo || 'Não foi possível concluir. Tente de novo.'));
      setLinhas((atuais) => atuais.map((e) => (e.id === p.empresa.id ? { ...e, situacao: suspender ? 'suspenso' : 'ativo' } : e)));
      mostrar(resultadoSucesso(suspender ? 'Empresa suspensa.' : 'Empresa reativada.'));
      router.refresh();
    });
  };
  const colunas: ColunaTabela<EmpresaPlataforma>[] = [
    { id: 'nome', titulo: 'Empresa', celula: (e) => (
        <Link href={`/config/empresas/${e.id}`} className="link-nome" onClick={(ev) => ev.stopPropagation()}>
          {e.nome}
        </Link>
      ),
    },
    { id: 'codigo', titulo: 'Código', celula: (e) => <span className="codigo">{codigoExibido(e)}</span> },
    { id: 'cnpj', titulo: 'CNPJ', celula: (e) => <span className="sem-quebra">{e.cnpj ? formatarDocumento(e.cnpj) : AUSENTE}</span> },
    { id: 'situacao', titulo: 'Situação', celula: (e) => <SeloSituacao situacao={e.situacao} /> },
    { id: 'fdv', titulo: 'Macuxi FDV', celula: (e) => (temFdv(e) ? <span className="selo selo-ativo">Sim</span> : <span className="selo selo-inativo">Não</span>) },
    { id: 'modulos', titulo: 'Módulos', celula: (e) => <CelulaModulos modulos={e.modulos} /> },
    { id: 'criada', titulo: 'Criada em', celula: (e) => <span className="sem-quebra">{dataCriacao(e)}</span> },
    {
      id: 'acoes',
      titulo: '', // o botão da linha já diz "Ações de <empresa>" ao leitor de tela
      celula: (e) => {
        const itens = itensAcaoEmpresa(e).map((i) => ({ chave: i.chave, rotulo: i.rotulo, perigo: i.perigo, desabilitado: pendente, aoAcionar: () => { limpar(); setPedido({ chave: i.chave, empresa: e }); } }));
        // o clique no menu não abre a ficha da linha
        return itens.length > 0 ? <span onClick={(ev) => ev.stopPropagation()} onKeyDown={(ev) => ev.stopPropagation()}><MenuAcoes rotuloLinha={e.nome} acoes={itens} /></span> : null;
      },
    },
  ];
  return (
    <>
    <div className="titulo-lista">
      {/* A API não manda o total: com "Carregar mais" à vista, o número só das linhas carregadas daria a entender o total, e fica de fora. */}
      <h1>Empresas{cursor === null && <> <span className="contagem">· {visiveis.length}</span></>}</h1>
      <form method="get" action="/config" role="search" className="busca-lista" onSubmit={(ev) => { ev.preventDefault(); const q = termo.trim(); if (q && q !== busca) router.push(`/config?busca=${encodeURIComponent(q)}`); }}>
        <input
          type="search"
          name="busca"
          defaultValue={busca}
          maxLength={80}
          autoComplete="off"
          placeholder="Buscar por código ou nome"
          aria-label="Buscar por código ou nome"
          onChange={(ev) => setTermo(ev.target.value)}
        />
      </form>
    </div>
    <div className="cartao-tabela">
    <div className="tabela-rolavel com-sinal-rolagem legenda-so-leitor">
      <TabelaDensa
        colunas={colunas}
        linhas={visiveis}
        chaveLinha={(e) => e.id}
        aoClicarLinha={(e) => router.push(`/config/empresas/${e.id}`)}
        rotuloLinha={(e) => `Abrir empresa ${codigoExibido(e)}`}
        textoVazio={termo.trim() && linhas.length > 0 ? 'Nenhuma empresa encontrada.' : vazio}
        legenda="Empresas"
        temMais={cursor !== null}
        carregandoMais={pendente}
        aoCarregarMais={carregarMais}
      />
    </div>
    </div>
    <ResultadoAcao resultado={resultado} chave={chaveResultado} />
    <div className="barra-acoes barra-rodape-lista">
      <Link className="mx-botao" href="/config/empresas/nova">Nova empresa</Link>
    </div>
    {pedido && pedido.chave === 'redefinir_senha' && (
      <DialogoMotivo
        titulo={`Redefinir a senha do administrador de ${pedido.empresa.nome}?`}
        aviso="A senha atual deixa de valer."
        semTexto
        rotuloConfirmar="Redefinir senha"
        rotuloFechar="Cancelar"
        aoConfirmar={() => executar(pedido, '')}
        aoCancelar={() => setPedido(null)}
      />
    )}
    {pedido && pedido.chave !== 'redefinir_senha' && (
      <DialogoMotivo
        titulo={`${pedido.chave === 'suspender' ? 'Suspender' : 'Reativar'} ${pedido.empresa.nome}?`}
        textoObrigatorio
        rotuloTexto="Motivo"
        aviso={pedido.chave === 'suspender' ? `Os usuários da empresa deixam de entrar. ${AVISO_DADO_PESSOAL}` : AVISO_DADO_PESSOAL}
        validar={(r) => validarMotivo(r.texto)}
        rotuloConfirmar={pedido.chave === 'suspender' ? 'Suspender' : 'Reativar'}
        rotuloFechar={pedido.chave === 'suspender' ? 'Manter ativa' : 'Cancelar'}
        destrutivo={pedido.chave === 'suspender'}
        aoConfirmar={(r) => executar(pedido, r.texto.trim())}
        aoCancelar={() => setPedido(null)}
      />
    )}
    {senha && <DialogoSenha nome={senha.nome} senha={senha.senha} aoFechar={() => setSenha(null)} />}
    </>
  );
}
