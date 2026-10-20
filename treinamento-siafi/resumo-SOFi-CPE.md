# Resumo SOFi/CPE — o que estudamos (atualizado em 20/10/2026)

## 1. Identificação

| Item | Valor |
|---|---|
| UO | 1251 – PMMG |
| UE CPE | 1250057 |
| UE CPE MAMB | 1250058 |
| UPG | 25 |
| Ordenador (matrícula) | 1305820 |
| Unidades atendidas | BPGd, 25º BPM MAmb, 24º BPMRv |

## 2. Contas bancárias (onde chega o dinheiro)

GMIFP = 3900 + fonte (2 dígitos) + IPU (1 dígito).

| Fonte | GMIFP | Banco | Agência | Conta | O que paga |
|---|---|---|---|---|---|
| 52 SEMAD | 3900522 | 999 | 09001-9 | 900158-6 | Ticket (emp. 718), diárias, eventos Paladir (2472) |
| 60 PMMG | 3900602 | 999 | 09001-9 | 900795-5 | Simpress 39.19, diárias 15.01 |
| 73 PRF | 3900731 | 001 BB | 01615-2 (conferir: 016152-2) | 22.085-X | Ticket (862), limpeza Tática (863), Master Clean (886), Elevtech (2936), diárias BPMRv |
| 83 DER | 3900832 | 999 | 09001-9 | 900.673-4 | Água COPASA (1080), Elevadores Milênio (1323), empenhos 399, 470, 825 |
| 10 Ordinários | 3900101 | Conta Única | — | — | Diárias, Simpress RP 2025, BSC LPR |

- Saldo de banco: **96 › 09**.
- Acordo PRF no empenho (janela Contrato/Convênio):
  - **Entrada:** tipo **11**, nº **9210809**.
  - **Saída (opcional):** tipo **2/1** + nº do contrato SIAD (ex.: 9523324).
  - Depois: **Enter → PF6**.
  - O erro "G0B – número inexistente" significa número digitado errado.

## 3. Elemento e item (os mais usados)

**Elementos**

| Código | Significa |
|---|---|
| 15 | diárias militar |
| 30 | material de consumo |
| 37 | locação de mão de obra |
| 39 | serviços de terceiros – PJ |
| 40 | serviços de TIC (aparece na cota PRF) |
| 52 | equipamentos e material permanente (capital, 4490) |

**Itens**

| Código | Significa |
|---|---|
| 15.01 | diária militar |
| 37.01 | limpeza e conservação (cessão de mão de obra: INSS 11% + ISS na liquidação) |
| 39.12 | energia/luz (só faturas CEMIG pontuais) |
| 39.13 | água e esgoto (COPASA) |
| 39.19 | locação de máquinas e equipamentos (Simpress) |
| 39.21 | manutenção (elevadores, videomonitoramento) |
| 39.26 | encargos financeiros (juros/multa por atraso) |
| 39.43 | manutenção de frota (Ticket Log) |
| 39.55 | eventos |

**Item 30 frequente no CPE:** 30.05, 30.16, 30.17, 30.19, 30.20, 30.22, 30.23, 30.25. O CPE não compra fardas, alimentos nem ração.

## 4. Dotação orçamentária

Ordem: **UO · função · subfunção · programa · ação · subativ. · natureza · item · fonte · IPU · IPE**

| Campo | Código | Significado |
|---|---|---|
| UO | 1251 | PMMG |
| Função | 06 | Segurança Pública (10 = Saúde) |
| Subfunção | 181 | Policiamento (302 = assist. hospitalar) |
| Programa | 137 | Polícia Ostensiva (135 = Proteção Social dos Militares) |
| Ação | 4374 | Policiamento Especializado (IPE 0) |
| | 4366 | Estruturação e Modernização (IPE 1, projeto estratégico) |
| | 4365 | Policiamento Ostensivo Geral |
| | 2060 | Assistência à Saúde |
| Subativ. | 0001 | subprojeto/subatividade |
| Natureza | 3 · 3 · 90 · xx | corrente · outras desp. correntes · aplicação direta · elemento |
| | 4 · 4 · 90 · 52 | capital · investimento · aplicação direta · equipamentos |
| Fonte | 10 | recursos ordinários |
| | 52 | taxa de fiscalização ambiental (SEMAD) |
| | 60 | diretamente arrecadados |
| | 73 | acordo de cooperação com a União (PRF) |
| | 83 | multas de trânsito/FUNTRANS (DER) |
| IPU | 1 | execução direta |
| | 2 | recebido de outra UO para livre utilização |
| | 8 | emenda parlamentar |
| IPE | 0 | demais projetos e atividades |
| | 1 | projeto estratégico |

- **IPU** = Identificador de Procedência e **U**so.
- **IPE** = Identificador de Projeto **E**stratégico. No PARO, esse campo aparece como IAG.

**Linhas reais**
- Limpeza: `1251 · 06 181 137 4374 0001 · 339037 · 01 · 73 · 1 · 0`
- BSC: `1251 · 06 181 137 4366 0001 · 339039 · 21 · 10 · 8 · 1`

## 5. Crédito × cota × dinheiro

| Pergunta | Conta | Saldo normal | Nível |
|---|---|---|---|
| Quanto orçamento tenho? | **6.2.2.1.1** Crédito disponível | C | grupo (3390/4490), sem elemento — aux. nível 19 |
| Quanto posso empenhar? | **9.9.8.0.2.03.01** Cota a empenhar – GMIFP | D | até o elemento (339037) — aux. nível 11 |
| Item controlado? | **9.9.8.0.2.03.02** Cota a empenhar – elemento/item | D | até o item (339039 19) |
| Tenho dinheiro? | **96 › 09** e 1.1.1.1.2.02.01.01.01 (cota financeira) | D | GMIFP / elemento / item |

**Regras**
- Crédito ≥ cota.
- Só se empenha o que estiver liberado na **.01**, ou na **.02** se o item for controlado.
- Empenho ou reforço lança a **C** na cota e diminui o saldo.

**Como ler a conta auxiliar da cota (31 dígitos)**
- Ordem: `1 · 1251 · 06181137 · 4374 · 0001 · 339039 · 73 · 1 · 0`
- O **1** inicial é o tipo de crédito, não faz parte da UO.

**Posição em 20/10/2026 (UE 1250057)**
- Crédito 6.2.2.1.1: **366.180,36**.
- Cota .01: 363.213,42 → **365.713,42** depois da liberação dos 2.500,00 da PRF.
- Cota .02: **466,94**. São 339039.19, fonte 60: 319,83 (4374) e 147,11 (saúde, 2060).

Linhas da cota .01:

| Ação | Natureza | Fonte·IPU·IPE | Saldo |
|---|---|---|---|
| 4365 | 339015 diárias | 60·2·0 | 672,00 |
| 4374 | 339015 diárias | 52·2·0 | 6.062,96 |
| 4374 | 339015 diárias | 73·1·0 | 23.987,82 |
| 4374 | 339030 material | 73·1·0 | 1.500,00 |
| 4374 | 339037 limpeza | 73·1·0 | 52.778,73 |
| 4374 | 339039 serviços PJ | 52·2·0 | 12,29 |
| 4374 | 339039 serviços PJ | 73·1·0 | 17.265,06 |
| 4374 | 339040 | 73·1·0 | 6.008,92 |
| 4374 | 449052 equipamentos | 73·1·0 | 257.425,64 |

**Repasse de cota (LCP 1282, transação RCOD)**
- Exemplo: doc 6279, vindo da UE **1250005 – DRH** (diárias).
- No CPE, o repasse lança:
  - 5.2.2.2.9.02 ↔ **6.2.2.1.1** (crédito);
  - **9.9.8.0.2.03.01** ↔ 9.9.8.0.2.06.03 (cota).
- O mesmo documento leva crédito e cota juntos.
- Para ver isso no sistema: Extrato da conta → ícone **Lanc** do movimento.

**Ciclo do crédito**
1. Disponível **6.2.2.1.1**
2. Empenho → **6.2.2.1.3.01** (a liquidar)
3. Liquidação → **.03** (liquidado a pagar)
4. OP → **.04** (pago)

## 6. Outras contas de consulta

| Conta | O que é |
|---|---|
| 1.1.1.1.2.02.01.01.01 | Cota financeira a utilizar (dinheiro por GMIFP/elemento/item) |
| 1.1.5.6.1.01 | Almoxarifado (material de consumo) |
| 2.1.3.1.1.01 | Fornecedores a pagar |
| 2.1.8.8.1.01 | IRRF a recolher (credor Estado de MG 18.715.615/0001-60) |
| 2.1.8.8.1.03 | INSS retido |
| 2.1.8.8.1.88 | ISS retido (aux.: ano/CNPJ prefeitura/GMIFP) |
| 8.2.1.1.1 a .4 | DDR (disponível → empenho → liquidação → utilizada) |

## 7. Retenções

- **INSS 11%** (cessão de mão de obra) e **ISS** na liquidação.
- **IRRF** na OP, sobre o bruto: 1,2% para material, 4,8% para serviço.
- O INSS vence **dia 20**. O ISS vence conforme cada prefeitura.
- A guia de retenção sai da mesma fonte da despesa.
- Exemplo (Tática, emp. 863, liq. 6, competência 09/2026):

| | Valor |
|---|---|
| Bruto | 16.768,71 |
| INSS | 1.844,56 |
| ISS 5% | 838,44 |
| Líquido | 14.085,71 |

## 8. Roteiro SIAFI-MG

| Ação | Caminho |
|---|---|
| Empenho | 51 › 01 |
| Liquidação | 51 › 04 |
| Anulação de liquidado | 51 › 05 |
| Pagamento (OP, guias por código de barras) | 71 |
| Consultas | 95 |
| Saldo banco | 96 › 09 |
| Relatórios | 99 |

- Contratos passam antes pelo SIAD (especificação efetivada).

## 9. Repasse financeiro (DF)

- O pedido é feito **depois da liquidação**, por GMIFP.
- Exceção: diárias, que podem ir no total por GMIFP com credor "DIVERSOS".
- Nunca deixar em branco o nº do empenho e a data da liquidação.

## 10. Convênios: vedações (conferir o artigo antes de citar)

**Não pode no plano de trabalho**
- pagar servidor ou militar a qualquer título (honorários, consultoria, gratificação);
- taxa de administração;
- multas e juros;
- despesa fora do objeto ou fora da vigência.

**Pode, se estiver previsto e ligado ao objeto**
- honorários de PJ ou profissional contratado.

**Normas**
- Recurso da União: Dec. 11.531/2023 e Portaria Conjunta MGI/MF/CGU 33/2023. A regra antiga era a PI 424/2016, art. 38.
- Recurso do Estado de MG: Dec. 46.319/2013.

## 11. Regras gerais

- Empenho sem movimento por 90 dias é anulado (Dec. 37.924/96).

## 12. Materiais de treino

| Material | Onde |
|---|---|
| Quiz SOFi | https://claude.ai/artifact/AuL7WS1cN91zX11iRvdayU |
| Simulador SIAFI-MG (senha de treino: TREINO) | https://claude.ai/artifact/2QP7F5kSfuhm5ynip6kbHi |
| Roteiros, cola de pagamento e mapa mental | pasta `treinamento-siafi/` |
