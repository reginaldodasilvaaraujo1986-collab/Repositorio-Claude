# SOFi/CPE — dados fixos para execução (empenho, liquidação, pagamento)

Seção de Orçamento e Finanças do Comando de Policiamento Especializado (CPE) da PMMG.
Responda sempre em português, de forma curta e específica da SOFi/CPE.

## Identificação

| Item | Valor |
|---|---|
| UO | 1251 (PMMG) |
| UE CPE | 1250057 |
| UE CPE MAMB | 1250058 |
| UPG | 25 |
| Ordenador (matrícula) | 1305820 |
| Unidades atendidas | BPGd, 25º BPM MAmb, 24º BPMRv |

## Fontes e contas para pagamento

GMIFP = grupo (3900) + fonte (2 dígitos) + IPU (1 dígito).

| Fonte | GMIFP | Banco | Agência | Conta | Paga hoje |
|---|---|---|---|---|---|
| SEMAD 52.20 | 3900522 | 999 | 09001-9 | 900158-6 (SIAFI: "PMMG X FEAM FTE 52.2", tipo CITTV conta interna) | Ticket (emp. 718; credor CNPJ 08.273.364/0001-57 — atenção: em 22/10 o liquidado a pagar da Ticket, 229.064,56, está todo na 339039.43 fonte 73; conferir se o 718 é SEMAD ou PRF), diárias, eventos Paladir (2472) |
| PMMG 60.20 | 3900602 | 999 | 09001-9 | 900795-5 (SIAFI: "Recurso Fundo Especial do Poder Judiciário subst a FT 10", tipo CITTV) | Simpress 39.19 (318 e 322/2025), diárias 15.01 |
| PRF 73.10 | 3900731 | 001 (Banco do Brasil) | 01615-2 (confirmado na 96›09) | 22.085-X (SIAFI: 000000022085 X, tipo CMUTV) | Ticket (emp. 862), limpeza Tática (emp. 863, 339037.01, PT 06.181.137.4374.0001, IPU 1, IPE 0, proc. SIAD 250457/21/2025), Master Clean (886), Elevtech (2936), diárias do BPMRv; contrato/convênio de ENTRADA no empenho: tipo 11 (acordo/mútua coop. téc.) nº 9210809 |
| DER 83.20 | 3900832 | 999 | 09001-9 | 900.673-4 (SIAFI: "Convênio DEER/MG - 30.019/21", tipo CITTV) | Água COPASA (emp. 1080), Elevadores Milênio (1323), empenhos 399, 470 e 825 (39.13/39.21) |
| Fonte 10 | 3900101 | Conta Única | — | — | Diárias, Simpress RP 2025, BSC LPR (espec. SIAD 7256852) |

Saldos 96›09 em 22/10/2026: PRF 174.868,20 (sem aplicação) · SEMAD 209.926,42 · fonte 60 4.836,05 · DER 2.568,37

Unidade financiadora no EMPENHO (51 › 01): fonte 83.20 (DER) → 4381 · fonte 60.20 (PMMG) → 4031 · fonte 52.20 (SEMAD) → 2091

Sempre que o usuário informar uma conta nova, atualize esta tabela.

## Elementos-item usados

- 15.01 diárias militar
- 37.01 limpeza (cessão de mão de obra: INSS 11% + ISS na liquidação)
- 39.12 energia (só faturas CEMIG pontuais; a CEMIG da PM é paga por setor centralizado)
- 39.13 água e esgoto
- 39.19 locação de máquinas e equipamentos
- 39.21 manutenção (elevadores, videomonitoramento)
- 39.26 encargos financeiros
- 39.43 manutenção de frota (Ticket Log, RAD quinzenal)
- 39.55 eventos

Despesas da fonte 73.10 (PRF) para pesquisar saldo de empenho (lista da SOFi, out/2026):
37.01 conservação/limpeza · 39.19 reprografia · 39.21 manutenção usina fotovoltaica · 39.22 manutenção plataforma elevatória · 39.52 estagiários · 39.43 Ticket Log BPMRv · 40.04 internet · 47.07 taxa de resíduos sólidos

## Dotação (PARO 2026, Anexo VII e VIII)

Linha do SIAFI: UO · função subfunção programa P/A C/A · natureza · item · fonte · IPU (Proc.) · IPE

- 1251 PMMG · 06 Segurança Pública · 181 Policiamento · 137 Polícia Ostensiva
- Ações: 4374 Policiamento Especializado (IAG 0) · 4366 Estruturação e Modernização (IAG 1, projeto estratégico)
- Fontes: 10 recursos ordinários · 52 taxa de fiscalização ambiental (SEMAD) · 60 diretamente arrecadados · 73 acordos de cooperação com a União (PRF) · 83 multas de trânsito/FUNTRANS (DER)
- IPU: 1 execução direta · 2 recebidos de outra UO p/ livre utilização · 8 emendas parlamentares
- IPE do SIAFI coincide com o IAG do PARO nos casos vistos (limpeza 4374 → 0; BSC 4366 → 1)
- Exemplos: limpeza 1251 · 06 181 137 4374 0001 · 339037 · 01 · 73 · 1 · 0 / BSC 1251 · 06 181 137 4366 0001 · 339039 · 21 · 10 · 8 · 1

## Contas de consulta (extrato de conta contábil)

- 9.9.8.0.2.03.01 Cota descentralizada a empenhar (GMIFP): saldo de ORÇAMENTO que ainda dá para empenhar (saldo devedor = disponível; empenho/reforço lança a crédito e reduz). Não é dinheiro em banco (banco: 96 › 09).
  - Nível auxiliar 11: tipo crédito / UO / programa de trabalho / natureza / fonte / IPU / IPE
  - Auxiliar (31 dígitos): 1 · 1251 · 06181137 · 4374 · 0001 · natureza (6) · fonte (2) · IPU · IPE. Ex.: 1125106181137437400013390397310 = 339039 · 73 · 1 · 0 (serviços PJ, PRF) · out/2026: 288.415,88 − emp. 3325 21.319,74 − reforços 123 (250.000,00) e 124 (0,08) = 17.096,06 D
  - Linhas da UE 1250057 em 20/10/2026 (total 363.213,42 D): 4365 339015 60·2·0 672,00 · 4374 339015 52·2·0 6.062,96 · 339015 73·1·0 23.987,82 · 339030 73·1·0 1.500,00 · 339037 73·1·0 52.778,73 · 339039 52·2·0 12,29 · 339039 73·1·0 14.765,06 · 339040 73·1·0 6.008,92 · 449052 73·1·0 257.425,64
- 6.2.2.1.1 Crédito disponível (natureza só 3390/4490, sem elemento). 20/10/2026: 366.180,36 C = cota .01 363.213,42 + cota .02 466,94 + 2.500,00 sem cota (custeio PRF 3390·73)
- 9.9.8.0.2.03.02 Cota a empenhar elemento/item (itens controlados, ex. 39.19). 20/10/2026: 339039.19 fonte 60·2·0 → 4374 319,83 e 2060 (saúde, 10 302 135) 147,11
- 6.2.2.1.3.04 Crédito empenhado liquidado PAGO (auxiliar até o ITEM: …natureza(6) item(2) fonte(2) IPU IPE). Pago 2026 até 22/10: 5.275.506,03 — diárias 15.01 52,5% · Ticket 39.43 21,8% (1.150.563,66) · limpeza 37.01 11,4% · eventos 39.55 5,7% · estagiários 39.52 3,7% · água 39.13 1,7% · demais <1%. Por fonte: 73 51,1% · 52 31,8% · 83 11,6% · 60 5,4% · 10 0,1%
- 6.2.2.1.3.03 Liquidado a pagar em 22/10/2026: 261.007,42 — 339039.43 fonte 73 (Ticket) 229.064,56 (87,8%) · 4366 449052.07 fonte 10 24.331,88 (capital; não aparece em 2.1.3.1.1.01) · 39.13 DER 3.330,09 · 40.04 PRF 1.916,66 · 39.12 DER 1.299,42 · 15.01 SEMAD 822,00 · 39.26 242,81. Fornecedores 237.345,65 = 261.007,42 − 24.331,88 + 670,11 (RP 2025)
- Para empenhar: conferir .01 (por elemento) OU .02 (se o item for controlado)
- Repasse de cota (LCP 1282, transação RCOD/RCODUFG; ex. doc 6279 de 02/10/2026, diárias 4365 339015 fonte 60, origem UE 1250005 DRH PMMG): na origem 6.2.2.1.1 ↔ 6.2.2.2.9.02 e 9.9.8.0.2.03.01 ↔ 9.9.8.0.2.06.03; no CPE 5.2.2.2.9.02 ↔ 6.2.2.1.1 e 9.9.8.0.2.03.01 ↔ 9.9.8.0.2.06.03 (conta par da cota = 9.9.8.0.2.06.03; lados D/C a confirmar na coluna à direita). 6.2.2.1.1 usa nível auxiliar 19 (sem elemento); 9.9.8.0.2.03.01 usa nível 11

## Roteiro no SIAFI-MG

- Empenho / liquidação / anulação: nav. 51 › 01 (empenho), 51 › 04 (liquidação), 51 › 05 (anulação de liquidado)
- Pagamento: nav. 71 (OP por credor; guias por código de barras, título bancário Empenho ou Retenção)
- Consultas: 95; saldo de conta banco: 96 › 09; relatórios: 99
- Menu 95 (Movimentação da Despesa, ação 1 consultar / 2 imprimir): 01 extrato de empenho · 02 resumo de empenho · 03 saldo liquidado a pagar (orçamento corrente) · 04 empenhos emitidos · 05 extrato RP · 06 resumo RP · 07 saldo RP/folha exerc. anteriores · 08 retenção/consignação/depósitos · 09 pagamentos por credor · 10 saldo a pagar folha · 11 saldo a pagar contratos administrativos/estagiários (pág. 1/2)
- Contratos passam antes pelo SIAD (especificação de conformidade efetivada)
- Empenho fonte 73 (PRF): janela "Contrato/Convênio" — Saída (opcional): tipo 2/1 contrato de serviço + nº do contrato SIAD (ex. 9523324) · Entrada: tipo 11 (acordo/mútua coop. téc.) nº 9210809 → Enter → PF6 (Sel). Erro "G0B-número contrato/convênio inexistente" = número digitado errado

## Retenções

- Exemplo real (Tática, emp. 863, liq. 6, competência 09/2026): bruto 16.768,71 · INSS 11% 1.844,56 · ISS 5% 838,44 · líquido 14.085,71
- INSS retido: 2.1.8.8.1.03 · ISS: 2.1.8.8.1.88 (aux.: ano/CNPJ prefeitura/GMIFP) · IRRF: 2.1.8.8.1.01 (credor Estado de MG 18.715.615/0001-60)

- IRRF na OP sobre o bruto: 1,2% material, 4,8% serviço
- INSS 11% (cessão de mão de obra) e ISS na liquidação
- INSS vence dia 20; ISS conforme cada prefeitura
- EFD-Reinf: confirmar com a DF se o envio é centralizado
- A guia de retenção sai da mesma fonte da despesa

## Repasse (DF)

- Pedido após a liquidação (exceto diárias/adiantamentos), por GMIFP
- Planilha: UE, GMIFP, elemento-item, nº empenho, ano, data da liquidação, banco, agência, conta convênio, credor, retenções, valor principal
- Diárias: pode ir o total por GMIFP com credor "DIVERSOS"
- Nunca deixar vazios o nº do empenho e a data da liquidação

## Regras

- Empenho 90 dias sem movimento é anulado (Dec. 37.924/96)
- Não reproduzir nomes de pessoas reais dos documentos
- Simulador de treino: senha sempre "TREINO"; nunca pedir senha real
