# Simulação do Início mínimo do BKO (decisão 58 A do Alexandre, MC-0213). Gera inicio-completo.html e inicio-parcial.html.
CSS = """
:root{--mx-tamanho-texto:var(--mx-tamanho-pequeno);--mx-tamanho-h1:var(--mx-tamanho-grande);--mx-tamanho-titulo-cartao:var(--mx-tamanho-pequeno);--mx-letras-caixa-alta:.04em;--mx-medida-canto-cartao:8px}/* tokens do #881 (este branch é anterior a ele) */
*{box-sizing:border-box}body{margin:0;font:var(--mx-tamanho-texto)/1.4 var(--mx-fonte-texto);color:var(--mx-cor-grafite);background:var(--mx-cor-perola)}
.topo{display:flex;align-items:center;gap:16px;background:var(--mx-cor-azul-noite);color:var(--mx-cor-branco);height:56px;padding:0 24px}
.topo img{height:20px}.topo .emp{font-size:var(--mx-tamanho-texto)}.topo a{color:var(--mx-cor-branco)}.topo .dir{margin-left:auto;display:flex;gap:16px;align-items:center}
.casca{display:grid;grid-template-columns:240px minmax(0,1fr);min-height:calc(100vh - 56px)}
.menu{background:var(--mx-cor-grafite);color:var(--mx-cor-branco);padding:12px 0}.menu a{display:block;color:var(--mx-cor-branco);text-decoration:none;padding:9px 20px}
.menu a.at{background:var(--mx-cor-grafite-menu);box-shadow:inset 3px 0 var(--mx-cor-sol-claro)}
.menu h3{margin:14px 20px 4px;font-size:var(--mx-tamanho-micro);font-weight:600;color:var(--mx-cor-sol-claro);text-transform:uppercase;letter-spacing:var(--mx-letras-caixa-alta)}
main{padding:24px}
h1{margin:0 0 4px;font-size:var(--mx-tamanho-h1);font-weight:700;color:var(--mx-cor-azul-noite)}
.sub{margin:0 0 16px;color:var(--mx-cor-texto-secundario)}
.tit{margin:0 0 6px;font-size:var(--mx-tamanho-titulo-cartao);font-weight:700;color:var(--mx-cor-azul-noite);text-transform:uppercase;letter-spacing:var(--mx-letras-caixa-alta)}
.g{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:12px}
a.atalho{grid-column:span 4;display:flex;align-items:center;gap:12px;background:var(--mx-cor-branco);border:1px solid var(--mx-cor-borda-tabela);border-radius:var(--mx-medida-canto-cartao);padding:16px;text-decoration:none;color:inherit;min-height:72px}
a.atalho:hover{border-color:var(--mx-cor-azul-noite)}
a.atalho b{display:block;font-size:var(--mx-tamanho-medio);color:var(--mx-cor-azul-noite)}
a.atalho span{color:var(--mx-cor-texto-secundario)}
a.atalho .seta{margin-left:auto;font-size:var(--mx-tamanho-grande);color:var(--mx-cor-azul-noite)}
.marca{background:var(--mx-cor-aviso-fundo);color:var(--mx-cor-aviso-texto);font-size:var(--mx-tamanho-micro);padding:2px 8px;border-radius:10px}
@media (max-width:767px){.casca{grid-template-columns:1fr}.menu{display:none}.topo{padding:0 16px}.topo .emp,.topo .nome,.topo .marca{display:none}main{padding:16px}a.atalho{grid-column:1/-1}}
"""
ATALHOS = {
  'Pedidos': ('Lançar e acompanhar pedidos', '/pedido/pedidos'),
  'Notas fiscais': ('Emitir e consultar NF-e', '/faturamento/notas'),
  'Clientes': ('Cadastro de clientes', '/cadastros/clientes'),
}
MENU = {'Pedidos':[('PEDIDOS',['Pedidos'])],'Notas fiscais':[('FATURAMENTO',['Pedidos a faturar','Notas fiscais','Títulos a receber'])],'Clientes':[('CADASTROS',['Clientes','Produtos','Tabelas de preço'])]}
def pagina(atalhos, nome, perfil):
    menu = '<a class="at" href="#">Início</a>' + ''.join(f'<h3>{g}</h3>' + ''.join(f'<a href="#">{i}</a>' for i in itens) for k in ['Clientes','Pedidos','Notas fiscais'] if k in atalhos for g,itens in MENU[k])
    cards = ''.join(f'<a class="atalho" href="{ATALHOS[a][1]}"><div><b>{a}</b><span>{ATALHOS[a][0]}</span></div><span class="seta" aria-hidden="true">→</span></a>' for a in atalhos)
    return f'''<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Início</title><link rel="stylesheet" href="../../../packages/ui/src/tokens.css"><style>{CSS}</style></head><body>
<div class="topo"><img src="../../marca/ativos/2026-11-22-v1/macuxi-erp-a-negativo-azul-noite.svg" alt="Macuxi ERP"><span class="emp">Comercial Tarumã Fictício Ltda · Matriz Manaus</span><span class="dir"><span class="marca">SIMULAÇÃO · dados fictícios</span><span class="nome">{nome} ({perfil})</span><a href="#">Sair</a></span></div>
<div class="casca"><nav class="menu">{menu}</nav><main><h1>Início</h1><p class="sub">Olá, {nome.split()[0]}. Por onde quer começar?</p><h2 class="tit">Atalhos</h2><div class="g">{cards}</div></main></div></body></html>'''
open('inicio-completo.html','w').write(pagina(['Pedidos','Notas fiscais','Clientes'],'Ana Exemplo','administrador'))
open('inicio-parcial.html','w').write(pagina(['Pedidos'],'Bruno Exemplo','vendas'))
