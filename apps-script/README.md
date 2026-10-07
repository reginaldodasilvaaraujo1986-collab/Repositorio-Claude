# Painel de Cursos AET/CPE — Apps Script

Web App que lê a planilha **Controle de Cursos 2026** e mostra um painel interativo:

| Tela | O que mostra |
|---|---|
| **Visão geral** | KPIs (turmas, % de etapas concluídas, vencidas, vencem em 7 dias, formados, próxima turma), turmas em andamento/próximas, etapas críticas, progresso por turma, status das etapas (rosca + conclusão por fase), pendências por responsável, turmas por mês e formados por curso |
| **Cronograma** | Linha do tempo (Gantt) agrupada por curso, com janela *prazo de planejamento → prazo de finalização*, % concluído dentro da barra, marcador de etapas vencidas e linha de "hoje" |
| **Turmas** | Cartões ou tabela, ordenáveis, com progresso e matriz de decisão (licitação, docente externo, avaliação, diária, > 8 dias, autorização) |
| **Etapas** | Quadro Kanban por prazo (vencidas / 7 dias / 8–30 dias / depois) ou tabela ordenável |
| **Formandos** | Totais e detalhamento da aba *Formandos 2026* |
| **Regras e prazos** | Cartões com as regras R01–R13 |

Clicar em qualquer turma abre um **painel lateral** com o checklist completo (Antes / Durante / Depois).
**O status de cada etapa pode ser alterado direto no painel** — a alteração é gravada na aba operacional,
a *Data conclusão* é preenchida ao marcar "Feito" e tudo fica registrado na aba **Histórico Painel**.

**Edição direto no painel** (sempre na célula de origem; o painel nunca grava sobre fórmulas):

| O que | Onde editar no painel | Onde grava na planilha |
|---|---|---|
| Status da etapa | seletor colorido | coluna Status da aba do curso |
| Quem executa a etapa | seletor de responsável ao lado de cada etapa (integrantes da lista *Responsáveis AET* da aba Listas, cada um com sua cor) | coluna Responsável da aba do curso |
| Responsável, documento, observações e data de conclusão da etapa | botão ✎ da etapa | colunas da etapa na aba do curso |
| Datas e local da turma | detalhe da turma › *Editar datas, local ou cancelar* | linha da turma no resumo da aba do curso (Cadastro e prazos das etapas acompanham pelas fórmulas) |
| Observações da turma | idem | Cadastro de Turmas |
| Cancelar / reativar turma | idem › *Cancelar esta turma…* | "Situação temporal" no Cadastro (a fórmula original fica numa nota da célula e volta ao reativar) |
| Formados | tela Formandos (digite e Enter) | aba Formandos 2026 |

Toda alteração feita pelo painel fica registrada na aba **Histórico Painel**.

**Turmas novas e anos novos**

- **＋ Nova turma** (telas Turmas e Cronograma): escolhe o curso, a turma modelo (de onde vem o checklist), nome, datas, local e vagas. O painel cria a linha no resumo da aba do curso, o bloco de etapas (prazos recalculados pelas datas novas) e as linhas no Cadastro de Turmas, Painel Geral, Formandos e Calendario.
- **Seletor de ano** (barra lateral): cada ano é uma planilha separada, todas no mesmo link do painel.
- **＋ Criar 2027** (no seletor): faz uma cópia completa da planilha do último ano, avança as datas (mesmo dia da semana ou mesma data), zera status/conclusões/formados/histórico e mantém cursos, turmas, locais, vagas e checklists. A planilha de origem não é alterada. Os anos criados ficam registrados nas propriedades do script (chave `ANOS`).
  Na primeira criação o Google pede permissão extra de acesso ao Drive (para copiar o arquivo).

**Tudo cabe na tela, sem barra de rolagem** (como uma planilha): o que não cabe em um cartão vira página —
use as setas ‹ ›, a roda do mouse sobre o cartão ou ← →. Na visão geral os cartões avançam sozinhos a cada 12 s
(modo TV; pausa com o mouse em cima). Em telas menores a barra lateral vira uma faixa de ícones; no celular volta a rolagem natural.

Outros recursos: filtros globais (área, curso, situação, responsável), busca (`/`), tema claro/escuro,
exportação CSV, atalhos `1`–`6` para trocar de tela, `R` para recarregar, `Esc` para fechar; layout responsivo (celular).

## Como a planilha é lida

- **Cadastro de Turmas** → dados de cada turma (cabeçalho localizado automaticamente).
- **Abas operacionais** (IVD, Rodoviarios, Pilotagem, …) → detectadas automaticamente: qualquer aba com o
  resumo `Turma | Início | Término …` e blocos `Fase | … | Etapa | Status`. O N-ésimo bloco pertence à
  N-ésima turma do resumo (a mesma lógica das fórmulas `COUNTA` do resumo). **Criar uma aba nova no mesmo
  modelo já a inclui no painel.**
- **Formandos 2026**, **Regras e Prazos**, **Listas** → telas de apoio.
- A aba **Painel Geral** é ignorada (ela só espelha as outras).

## Instalação

1. Abra a planilha no Google Sheets → **Extensões › Apps Script**.
2. Crie apenas dois arquivos e cole o conteúdo:
   - `Code.gs` (script — no editor: **+ › Script**)
   - `Index.html` (no editor: **+ › HTML**, digite `Index` sem `.html`). É um arquivo único, gerado a partir de `fontes/` com `python3 apps-script/fontes/montar.py`; não edite o `Index.html` à mão.
3. Em **Configurações do projeto**, marque *Mostrar o arquivo de manifesto "appsscript.json"* e cole o `appsscript.json`
   (garante o fuso `America/Sao_Paulo`).
4. Selecione a função `diagnosticar` e clique em **Executar** — autorize e confira no log se as turmas e etapas foram lidas.
5. **Implantar › Nova implantação › App da Web**
   - *Executar como*: **Eu** (o app grava na planilha com a sua permissão)
   - *Quem pode acessar*: **Somente eu**; para a equipe, **Qualquer pessoa com Conta do Google** (conta pessoal)
     ou **Qualquer pessoa da organização** (Google Workspace). Atenção: com *Executar como: Eu*, quem acessa pode alterar status.
6. Abra a URL gerada. Na planilha também aparece o menu **📊 Painel › Abrir painel**.

> Ao atualizar o código, use **Implantar › Gerenciar implantações › Editar › Nova versão** para manter a mesma URL.

## Ajustes

Tudo fica no objeto `CONFIG` no topo de `Code.gs`: nomes das abas, status aceitos,
liga/desliga do histórico e tempo de cache (5 min — qualquer edição manual na planilha limpa o cache).

## Observação sobre a planilha atual

O painel avisa quando um prazo sai como data inválida (ano < 1950). Na versão enviada há dois casos:

- `Pilotagem!D156` = `=B8-25` → deveria ser `=B7-25`
- `Produtos Perigosos!D65` = `=B6-25` → deveria ser `=B5-25`

## Corrigir datas das etapas

Menu **📊 Painel › Corrigir datas das etapas** (na planilha): confere se Início, Término e Prazo sugerido
de cada etapa apontam para a linha da própria turma no resumo do topo da aba (ex.: `=B5`, `=C5`, `=B5-25`).
Linhas copiadas costumam apontar para a turma vizinha ou para uma linha vazia (prazo em 1899).
Mostra a lista do que vai mudar e só grava se você confirmar; cada correção fica no Histórico Painel.
Prazos digitados à mão (sem fórmula) são apenas listados para correção manual.
