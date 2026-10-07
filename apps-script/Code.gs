/**
 * Painel de Cursos AET/CPE — Web App (Google Apps Script)
 *
 * Fonte dos dados (planilha "Controle de Cursos 2026"):
 *  - "Cadastro de Turmas": turmas, área, matriz de decisão e situação.
 *  - Abas operacionais (IVD, Rodoviarios, Pilotagem, ...): resumo das
 *    turmas no topo (linha "Turma | Início | Término ...") e, abaixo,
 *    um bloco de etapas por turma (cabeçalho "Fase | ... | Etapa | Status").
 *    O N-ésimo bloco pertence à N-ésima turma do resumo, como nas
 *    fórmulas COUNTA do próprio resumo.
 *  - "Formandos 2026", "Regras e Prazos" e "Listas".
 *
 * Novas abas operacionais que sigam o mesmo modelo são detectadas
 * automaticamente — não é preciso alterar o código.
 */

const CONFIG = {
  TITULO: 'Controle de Cursos AET/CPE',
  ABA_CADASTRO: 'Cadastro de Turmas',
  ABA_FORMANDOS: 'Formandos 2026',
  ABA_REGRAS: 'Regras e Prazos',
  ABA_LISTAS: 'Listas',
  ABA_CALENDARIO: 'Calendario', // calendário oficial (Período | Treinamento | Qtd vagas | Local/Obs)
  ABA_HISTORICO: 'Histórico Painel',
  ABA_RESOLUCAO: 'Resolução', // cursos aprovados no SiGE por ano (criada pelo painel com os dados iniciais)

  // Abas que nunca são tratadas como operacionais.
  ABAS_IGNORADAS: ['Painel Geral'],

  // Unidades executoras. Ficam na coluna "Unidade executora" do Cadastro de
  // Turmas (criada pelo painel na primeira gravação). Vazio = regra abaixo.
  UNIDADES: ['BPMRv', 'BPM MAmb', 'BPGd'],

  // Status aceitos nas etapas (iguais à aba "Listas").
  STATUS_ETAPA: ['Pendente', 'Em execução', 'Feito', 'Não se aplica'],

  // Ao alterar status pelo painel, grava uma linha na aba de histórico.
  REGISTRAR_HISTORICO: true,

  CACHE_SEGUNDOS: 300
};

/* ================================================================== */
/* Entradas                                                            */
/* ================================================================== */

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle(CONFIG.TITULO)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('📊 Painel')
    .addItem('Abrir painel', 'abrirPainel')
    .addItem('Diagnóstico da leitura', 'diagnosticarUi')
    .addItem('Corrigir datas das etapas', 'corrigirReferenciasUi')
    .addItem('Preencher curso (SiGE) e cidade das turmas', 'preencherCursosUi')
    .addItem('Padronizar responsáveis das etapas', 'padronizarResponsaveisUi')
    .addSeparator()
    .addItem('Criar planilha nova (por unidade, já corrigida)', 'reorganizarPorUnidadeUi')
    .addSeparator()
    .addItem('Limpar cache', 'limparCache')
    .addToUi();
}

/** Qualquer edição manual invalida o cache para o painel refletir a planilha. */
function onEdit() {
  limparCache();
}

function abrirPainel() {
  const html = HtmlService.createHtmlOutputFromFile('Index')
    .setWidth(1500).setHeight(920);
  SpreadsheetApp.getUi().showModelessDialog(html, CONFIG.TITULO);
}

/* ================================================================== */
/* API chamada pelo front-end (google.script.run)                      */
/* ================================================================== */

/**
 * Retorna todos os dados do painel como string JSON
 * (google.script.run não transporta objetos Date).
 */
function getDadosPainel(forcar, ano) {
  const ss = planilha_(ano);
  const anoPlan = anoDaPlanilha_(ss);
  if (!forcar) {
    const emCache = lerCache_(anoPlan);
    if (emCache) return emCache;
  }
  const json = JSON.stringify(montarDados_(ss));
  gravarCache_(json, anoPlan);
  return json;
}

/**
 * Altera o status de uma etapa direto na aba operacional.
 * Confere se a linha ainda contém a mesma etapa antes de gravar,
 * para não escrever no lugar errado caso a planilha tenha mudado.
 */
function atualizarStatusEtapa(req) {
  if (CONFIG.STATUS_ETAPA.indexOf(req.status) < 0) {
    throw new Error('Status inválido: ' + req.status);
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const ss = planilha_(req.ano);
    const aba = ss.getSheetByName(req.aba);
    if (!aba) throw new Error('Aba não encontrada: ' + req.aba);

    const etapaAtual = String(aba.getRange(req.linha, req.colEtapa).getValue()).trim();
    if (etapaAtual !== String(req.etapa).trim()) {
      throw new Error('A planilha mudou desde o último carregamento. Atualize o painel e tente de novo.');
    }

    const celStatus = aba.getRange(req.linha, req.colStatus);
    const anterior = String(celStatus.getValue());
    celStatus.setValue(req.status);

    let conclusao = null;
    if (req.colConclusao) {
      const celData = aba.getRange(req.linha, req.colConclusao);
      if (req.status === 'Feito' && !celData.getValue()) {
        const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
        celData.setValue(hoje);
      }
      conclusao = iso_(data_(celData.getValue()));
    }

    if (CONFIG.REGISTRAR_HISTORICO) {
      registrarHistorico_(ss, [new Date(), usuario_(), req.aba, req.linha, req.turma || '', req.etapa, anterior, req.status]);
    }
    SpreadsheetApp.flush();
    limparCache();
    return JSON.stringify({ ok: true, status: req.status, conclusao: conclusao, anterior: anterior });
  } finally {
    lock.releaseLock();
  }
}

/**
 * Edita campos livres de uma etapa: responsável, observações,
 * documento/comprovação e data de conclusão. Nunca grava sobre fórmula.
 */
function atualizarEtapa(req) {
  return comTrava_(ss => {
    const aba = abaOuErro_(ss, req.aba);
    const cab = cabecalhoDoBloco_(aba, req.linha);
    const col = cab.col;
    conferir_(aba.getRange(req.linha, col['etapa'] + 1).getValue(), req.etapa);

    const mapa = { responsavel: 'responsavel', observacoes: 'observacoes', documento: 'documento/comprovacao', conclusao: 'data conclusao' };
    const mudou = [];
    Object.keys(mapa).forEach(campo => {
      if (!(campo in req.campos) || col[mapa[campo]] === undefined) return;
      const cel = aba.getRange(req.linha, col[mapa[campo]] + 1);
      const novo = campo === 'conclusao' ? (req.campos[campo] ? dataIso_(req.campos[campo]) : '') : String(req.campos[campo] || '').trim();
      const antigo = cel.getValue();
      if (texto_(antigo) === texto_(novo)) return;
      gravar_(cel, novo);
      mudou.push(campo + ': "' + texto_(antigo) + '" → "' + texto_(novo) + '"');
    });
    if (mudou.length) historico_(ss, req.aba, req.linha, req.turma, req.etapa, 'Edição da etapa', mudou.join('; '));
    return { ok: true, alteracoes: mudou.length };
  }, req.ano);
}

/**
 * Edita a turma: datas e local vão para a linha da turma no resumo da aba
 * do curso (o Cadastro e os prazos das etapas acompanham pelas fórmulas);
 * observações vão para o Cadastro de Turmas.
 */
function atualizarTurma(req) {
  return comTrava_(ss => {
    const mudou = [];
    const ini = req.inicio ? dataIso_(req.inicio) : null;
    const fim = req.fim ? dataIso_(req.fim) : null;
    if (ini && fim && fim < ini) throw new Error('O término não pode ser antes do início.');

    if (req.aba && req.linhaResumo) {
      const aba = abaOuErro_(ss, req.aba);
      const v = aba.getRange(1, 1, Math.min(aba.getLastRow(), 8), aba.getLastColumn()).getValues();
      const h = acharCabecalho_(v, ['turma', 'inicio', 'termino'], 8);
      if (h < 0) throw new Error('Resumo de turmas não encontrado na aba ' + req.aba + '.');
      const c = indice_(v[h]);
      conferir_(aba.getRange(req.linhaResumo, c['turma'] + 1).getValue(), req.turma);

      [['inicio', ini, 'início'], ['termino', fim, 'término']].forEach(([k, val, nome]) => {
        if (!val || c[k] === undefined) return;
        const cel = aba.getRange(req.linhaResumo, c[k] + 1);
        if (texto_(cel.getValue()) === texto_(val)) return;
        mudou.push(nome + ': ' + texto_(cel.getValue()) + ' → ' + texto_(val));
        gravar_(cel, val);
      });
      if ('local' in req && c['local/unidade'] !== undefined) {
        const cel = aba.getRange(req.linhaResumo, c['local/unidade'] + 1);
        const novo = String(req.local || '').trim();
        if (texto_(cel.getValue()) !== novo) {
          mudou.push('local: ' + texto_(cel.getValue()) + ' → ' + novo);
          gravar_(cel, novo);
        }
      }
      // Mantém o título do bloco ("... | Período: dd/mm/aaaa a dd/mm/aaaa") coerente.
      if (req.tituloLinha && (ini || fim)) {
        const celT = aba.getRange(req.tituloLinha, 1);
        const t = String(celT.getValue());
        const re = /Per[ií]odo:\s*\d{2}\/\d{2}\/\d{4}(\s*a\s*\d{2}\/\d{2}\/\d{4})?/;
        if (!celT.getFormula() && re.test(t)) {
          const i2 = ini || aba.getRange(req.linhaResumo, c['inicio'] + 1).getValue();
          const f2 = fim || aba.getRange(req.linhaResumo, c['termino'] + 1).getValue();
          celT.setValue(t.replace(re, 'Período: ' + texto_(i2) + ' a ' + texto_(f2)));
        }
      }
    }

    if ('unidade' in req && req.linhaCadastro && req.unidade) {
      const cad = cadastro_(ss);
      conferir_(cad.aba.getRange(req.linhaCadastro, cad.col['turma'] + 1).getValue(), req.turma);
      const cel = cad.aba.getRange(req.linhaCadastro, colunaUnidade_(cad) + 1);
      if (texto_(cel.getValue()) !== req.unidade) {
        mudou.push('unidade executora: ' + (texto_(cel.getValue()) || '(padrão)') + ' → ' + req.unidade);
        gravar_(cel, req.unidade);
      }
    }

    [['cursoOficial', 'curso (sige)', 'Curso (SiGE)', 'curso'], ['cidade', 'cidade', 'Cidade', 'cidade']].forEach(([k, chave, rotulo, nome]) => {
      if (!(k in req) || !req.linhaCadastro) return;
      const cad = cadastro_(ss);
      conferir_(cad.aba.getRange(req.linhaCadastro, cad.col['turma'] + 1).getValue(), req.turma);
      const cel = cad.aba.getRange(req.linhaCadastro, colunaCadastro_(cad, chave, rotulo) + 1);
      const novo = String(req[k] || '').trim();
      if (texto_(cel.getValue()) !== novo) {
        mudou.push(nome + ': ' + (texto_(cel.getValue()) || '(vazio)') + ' → ' + (novo || '(vazio)'));
        gravar_(cel, novo);
      }
    });

    if ('observacoes' in req && req.linhaCadastro) {
      const cad = cadastro_(ss);
      conferir_(cad.aba.getRange(req.linhaCadastro, cad.col['turma'] + 1).getValue(), req.turma);
      const cel = cad.aba.getRange(req.linhaCadastro, cad.col['observacoes'] + 1);
      const novo = String(req.observacoes || '').trim();
      if (texto_(cel.getValue()) !== novo) {
        mudou.push('observações atualizadas');
        gravar_(cel, novo);
      }
    }
    if (mudou.length) historico_(ss, req.aba || CONFIG.ABA_CADASTRO, req.linhaResumo || req.linhaCadastro, req.turma, '', 'Edição da turma', mudou.join('; '));
    return { ok: true, alteracoes: mudou.length };
  }, req.ano);
}

/**
 * Cancela a turma: grava "Cancelado" na Situação temporal do Cadastro
 * (a fórmula original fica guardada na nota da célula para poder reativar)
 * e acrescenta o motivo às Observações.
 */
function cancelarTurma(req) {
  return comTrava_(ss => {
    const cad = cadastro_(ss);
    conferir_(cad.aba.getRange(req.linhaCadastro, cad.col['turma'] + 1).getValue(), req.turma);
    const cel = cad.aba.getRange(req.linhaCadastro, cad.col['situacao temporal'] + 1);
    const formula = cel.getFormula();
    if (formula) cel.setNote(NOTA_FORMULA + formula);
    cel.setValue('Cancelado');

    const hoje = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy');
    const motivo = String(req.motivo || '').trim();
    const obs = cad.aba.getRange(req.linhaCadastro, cad.col['observacoes'] + 1);
    if (!obs.getFormula()) {
      const atual = String(obs.getValue() || '').trim();
      obs.setValue((atual ? atual + '\n' : '') + 'Cancelado em ' + hoje + (motivo ? ': ' + motivo : '') + '.');
    }
    historico_(ss, CONFIG.ABA_CADASTRO, req.linhaCadastro, req.turma, '', 'Turma cancelada', motivo);
    return { ok: true };
  }, req.ano);
}

/** Desfaz o cancelamento: devolve a fórmula da Situação temporal. */
function reativarTurma(req) {
  return comTrava_(ss => {
    const cad = cadastro_(ss);
    conferir_(cad.aba.getRange(req.linhaCadastro, cad.col['turma'] + 1).getValue(), req.turma);
    const cel = cad.aba.getRange(req.linhaCadastro, cad.col['situacao temporal'] + 1);
    const nota = cel.getNote();
    let formula = nota.indexOf(NOTA_FORMULA) === 0 ? nota.substring(NOTA_FORMULA.length).trim() : '';
    if (!formula) {
      const l = req.linhaCadastro;
      const fI = letra_(cad.col['inicio'] + 1) + l, fT = letra_(cad.col['termino'] + 1) + l;
      formula = '=IF(TODAY()<' + fI + ',"Planejamento",IF(TODAY()<=' + fT + ',"Em execução","Encerrado"))';
    }
    cel.setFormula(formula);
    if (nota.indexOf(NOTA_FORMULA) === 0) cel.clearNote();
    historico_(ss, CONFIG.ABA_CADASTRO, req.linhaCadastro, req.turma, '', 'Turma reativada', '');
    return { ok: true };
  }, req.ano);
}

/**
 * Grava a equipe da seção (coluna "Responsáveis AET" da aba Listas).
 * A lista de seleção da coluna Responsável das etapas usa esse intervalo.
 */
function salvarResponsaveis(req) {
  return comTrava_(ss => {
    const lista = (req.lista || []).map(x => String(x || '').trim()).filter(Boolean);
    if (!lista.length) throw new Error('Informe ao menos um nome.');
    const col = colunaResponsaveisListas_(ss);
    const aba = ss.getSheetByName(CONFIG.ABA_LISTAS);
    const antes = lerResponsaveis_(ss);
    const n = Math.max(antes.length, lista.length, 1);
    aba.getRange(2, col + 1, n, 1).setValues(Array.from({ length: n }, (_, i) => [lista[i] || '']));
    validacaoResponsaveis_(ss);
    historico_(ss, CONFIG.ABA_LISTAS, '', '', '', 'Equipe atualizada', antes.join(', ') + ' → ' + lista.join(', '));
    return { ok: true, lista: lista };
  }, req.ano);
}

/** Atualiza a quantidade de formados de uma linha da aba "Formandos 2026". */
function atualizarFormados(req) {
  return comTrava_(ss => {
    const aba = abaFormandos_(ss);
    if (!aba) throw new Error('Aba de formandos não encontrada.');
    const v = aba.getRange(1, 1, Math.min(aba.getLastRow(), 5), aba.getLastColumn()).getValues();
    const h = acharCabecalho_(v, ['curso', 'turma', 'formados'], 5);
    const c = indice_(v[h]);
    conferir_(aba.getRange(req.linha, c['curso'] + 1).getValue(), req.curso);
    conferir_(aba.getRange(req.linha, c['turma'] + 1).getValue(), req.turma);
    const campo = req.campo === 'matriculados' ? 'matriculados' : 'formados';
    const n = Number(campo === 'matriculados' ? req.matriculados : req.formados);
    if (!(n >= 0) || Math.floor(n) !== n) throw new Error('Informe um número inteiro (0 ou mais).');
    const coluna = campo === 'matriculados' ? colunaMatriculados_(aba, h, v[h]) : c['formados'];
    const cel = aba.getRange(req.linha, coluna + 1);
    const antigo = cel.getValue();
    gravar_(cel, n);
    historico_(ss, aba.getName(), req.linha, req.curso + ' / ' + req.turma, '', campo === 'matriculados' ? 'Matriculados' : 'Formados', texto_(antigo) + ' → ' + n);
    return { ok: true };
  }, req.ano);
}

/* ---------- apoio às edições ---------- */

const NOTA_FORMULA = 'Fórmula original (painel): ';

/** Unidade executora quando a coluna está vazia: Meio Ambiente → BPM MAmb; guardas → BPGd; demais → BPMRv. */
function unidadePadrao_(area, curso, turma) {
  const t = semAcento_([area, curso, turma].join(' '));
  if (/meio ambiente|ambiental|gepam|progea|mamb/.test(t)) return 'BPM MAmb';
  if (/guarda|bpgd/.test(t)) return 'BPGd';
  return 'BPMRv';
}

/** Índice (0-based) da coluna "Unidade executora" no Cadastro; cria o cabeçalho se não existir. */
function colunaUnidade_(cad) {
  return colunaCadastro_(cad, 'unidade executora', 'Unidade executora');
}

/** Índice (0-based) de uma coluna do Cadastro pelo cabeçalho; cria a coluna no fim se não existir. */
function colunaCadastro_(cad, chave, rotulo) {
  if (cad.col[chave] !== undefined) return cad.col[chave];
  const v = cad.aba.getRange(1, 1, Math.min(cad.aba.getLastRow(), 6), cad.aba.getLastColumn()).getValues();
  const h = acharCabecalho_(v, ['id', 'curso', 'turma'], 6);
  const largura = larguraCabecalho_(v[h]);
  if (cad.aba.getMaxColumns() <= largura) cad.aba.insertColumnAfter(cad.aba.getMaxColumns());
  const cel = cad.aba.getRange(h + 1, largura + 1);
  cad.aba.getRange(h + 1, largura).copyTo(cel, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  cel.setValue(rotulo);
  cad.col[chave] = largura;
  return largura;
}

/** Coluna "Matriculados" da aba de formandos (logo depois de Formados; criada se faltar). */
function colunaMatriculados_(aba, h, cabecalho) {
  const c = indice_(cabecalho);
  if (c['matriculados'] !== undefined) return c['matriculados'];
  let col = c['formados'] + 1;
  if (texto_(cabecalho[col])) col = larguraCabecalho_(cabecalho);
  const cel = aba.getRange(h + 1, col + 1);
  aba.getRange(h + 1, c['formados'] + 1).copyTo(cel, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  cel.setValue('Matriculados');
  return col;
}

/** Executa a gravação com trava, limpa o cache e devolve JSON. */
function comTrava_(fn, ano) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const r = fn(planilha_(ano));
    SpreadsheetApp.flush();
    limparCache();
    return JSON.stringify(r);
  } finally {
    lock.releaseLock();
  }
}

/** Grava um valor, recusando células com fórmula (para não apagar cálculos). */
function gravar_(cel, valor) {
  if (cel.getFormula()) {
    throw new Error('A célula ' + cel.getSheet().getName() + '!' + cel.getA1Notation() +
      ' é calculada por fórmula. Altere na planilha ou na célula de origem.');
  }
  cel.setValue(valor);
}

/** Confere se a linha ainda é a mesma (evita gravar no lugar errado). */
function conferir_(atual, esperado) {
  if (chave_(texto_(atual)) !== chave_(texto_(esperado))) {
    throw new Error('A planilha mudou desde o último carregamento ("' + texto_(atual) + '"). Atualize o painel e tente de novo.');
  }
}

function abaOuErro_(ss, nome) {
  const aba = ss.getSheetByName(nome);
  if (!aba) throw new Error('Aba não encontrada: ' + nome);
  return aba;
}

function cadastro_(ss) {
  const aba = abaOuErro_(ss, CONFIG.ABA_CADASTRO);
  const v = aba.getRange(1, 1, Math.min(aba.getLastRow(), 6), aba.getLastColumn()).getValues();
  const h = acharCabecalho_(v, ['id', 'curso', 'turma'], 6);
  if (h < 0) throw new Error('Cabeçalho do Cadastro de Turmas não encontrado.');
  return { aba: aba, col: indice_(v[h]) };
}

/** Acha, acima da linha da etapa, o cabeçalho "Fase | ... | Etapa | Status" do bloco. */
function cabecalhoDoBloco_(aba, linha) {
  const colA = aba.getRange(1, 1, linha, 1).getValues();
  for (let i = linha - 1; i >= 0; i--) {
    if (semAcento_(colA[i][0]) === 'fase') {
      const cab = aba.getRange(i + 1, 1, 1, aba.getLastColumn()).getValues()[0];
      return { linha: i + 1, col: indice_(cab) };
    }
  }
  throw new Error('Bloco de etapas não encontrado acima da linha ' + linha + '.');
}

/** "2026-10-05" → Date (meia-noite no fuso do script). */
function dataIso_(s) {
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new Error('Data inválida: ' + s);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function letra_(n) {
  let s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

function historico_(ss, aba, linha, turma, etapa, acao, detalhe) {
  if (!CONFIG.REGISTRAR_HISTORICO) return;
  registrarHistorico_(ss, [new Date(), usuario_(), aba, linha, turma || '', etapa || '', acao, detalhe || '']);
}

/* ================================================================== */
/* Montagem dos dados                                                  */
/* ================================================================== */

function montarDados_(ss) {
  ss = ss || planilha_();
  const avisos = [];

  const resolucao = lerResolucao_(ss);
  const cadastro = lerCadastro_(ss, avisos);
  const operacionais = lerAbasOperacionais_(ss, avisos);

  // Junta cadastro + resumo operacional pelo nome da turma.
  const porNome = {};
  cadastro.forEach(t => { porNome[chave_(t.turma)] = t; });

  const turmas = [];
  const etapas = [];
  operacionais.forEach(op => {
    op.turmas.forEach(resumo => {
      let t = porNome[chave_(resumo.turma)];
      if (!t) {
        avisos.push('Turma "' + resumo.turma + '" (aba ' + op.aba + ') não está no Cadastro de Turmas.');
        t = { id: 'x' + turmas.length, area: '', curso: op.aba, turma: resumo.turma, situacao: '' };
      }
      t.aba = op.aba;
      t.gid = op.gid;
      t.linhaResumo = resumo.linha;
      t.tituloLinha = resumo.tituloLinha || null;
      t.local = t.local || resumo.local;
      t.inicio = t.inicio || resumo.inicio;
      t.fim = t.fim || resumo.fim;
      t.prazoPlanejamento = resumo.prazoPlanejamento;
      t.prazoFinalizacao = resumo.prazoFinalizacao;
      if (t.formados == null) t.formados = resumo.formados;
      t.etapas = resumo.etapas.length;
      t._vinculada = true;
      turmas.push(t);

      resumo.etapas.forEach(e => {
        e.id = t.id + '-' + e.linha;
        e.turmaId = t.id;
        e.turma = t.turma;
        e.curso = t.curso;
        e.area = t.area;
        etapas.push(e);
      });
    });
  });

  // Turmas cadastradas sem aba operacional continuam no painel (sem etapas).
  cadastro.filter(t => !t._vinculada).forEach(t => {
    t.etapas = 0;
    turmas.push(t);
  });
  turmas.forEach(t => { delete t._vinculada; });
  turmas.sort((a, b) => String(a.inicio).localeCompare(String(b.inicio)));

  return {
    titulo: CONFIG.TITULO,
    planilha: ss.getName(),
    ano: anoDaPlanilha_(ss),
    anos: anosDisponiveis_(),
    url: ss.getUrl(),
    geradoEm: new Date().toISOString(),
    hoje: iso_(new Date()),
    statusEtapa: CONFIG.STATUS_ETAPA,
    podeEditar: true,
    turmas: turmas,
    etapas: etapas,
    formandos: lerFormandos_(ss),
    regras: lerRegras_(ss),
    calendario: lerCalendario_(ss, avisos),
    responsaveis: lerResponsaveis_(ss),
    unidades: CONFIG.UNIDADES,
    resolucao: resolucao,
    avisos: avisos
  };
}

/** "Cadastro de Turmas": cabeçalho localizado pela linha que tem ID + Curso + Turma. */
function lerCadastro_(ss, avisos) {
  const aba = ss.getSheetByName(CONFIG.ABA_CADASTRO);
  if (!aba) { avisos.push('Aba "' + CONFIG.ABA_CADASTRO + '" não encontrada.'); return []; }
  const v = aba.getDataRange().getValues();
  const h = acharCabecalho_(v, ['id', 'curso', 'turma'], 6);
  if (h < 0) { avisos.push('Cabeçalho do Cadastro de Turmas não encontrado.'); return []; }
  const c = indice_(v[h]);

  const turmas = [];
  for (let i = h + 1; i < v.length; i++) {
    const r = v[i];
    const turma = texto_(r[c['turma']]);
    if (!turma) continue;
    turmas.push({
      id: 't' + (texto_(r[c['id']]) || i).replace(/\.0$/, ''),
      linhaCadastro: i + 1,
      area: texto_(r[c['area']]),
      unidade: texto_(r[c['unidade executora']]) || unidadePadrao_(r[c['area']], r[c['curso']], r[c['turma']]),
      curso: texto_(r[c['curso']]),
      cursoOficial: texto_(r[c['curso (sige)']]) || grupoPadrao_([r[c['curso']], r[c['turma']]].join(' ')),
      cursoOficialSugerido: !texto_(r[c['curso (sige)']]),
      cidade: texto_(r[c['cidade']]) || cidadePadrao_(texto_(r[c['turma']]), texto_(r[c['local/unidade']])),
      turma: turma,
      local: texto_(r[c['local/unidade']]),
      inicio: iso_(data_(r[c['inicio']])),
      fim: iso_(data_(r[c['termino']])),
      duracao: numero_(r[c['duracao (dias)']]),
      licitacao: texto_(r[c['licitacao?']]),
      docenteExterno: texto_(r[c['docente externo?']]),
      avaliacao: texto_(r[c['avaliacao?']]),
      diaria: texto_(r[c['diaria?']]),
      mais8dias: texto_(r[c['curso > 8 dias?']]),
      autorizacaoDiaria: texto_(r[c['autorizacao previa de diaria?']]),
      situacao: texto_(r[c['situacao temporal']]),
      observacoes: texto_(r[c['observacoes']]),
      formados: numero_(r[c['formados']])
    });
  }
  return turmas;
}

/**
 * Detecta abas operacionais: precisam ter um resumo com cabeçalho
 * "Turma | Início | Término" e ao menos um bloco "Fase ... Etapa ... Status".
 */
function lerAbasOperacionais_(ss, avisos) {
  const af = abaFormandos_(ss);
  const fixas = [CONFIG.ABA_CADASTRO, af ? af.getName() : CONFIG.ABA_FORMANDOS, CONFIG.ABA_REGRAS, CONFIG.ABA_LISTAS, CONFIG.ABA_HISTORICO, CONFIG.ABA_CALENDARIO, CONFIG.ABA_RESOLUCAO]
    .concat(CONFIG.ABAS_IGNORADAS);
  const saida = [];

  ss.getSheets().forEach(aba => {
    const nome = aba.getName();
    if (fixas.indexOf(nome) >= 0) return;
    const v = aba.getDataRange().getValues();

    const hResumo = acharCabecalho_(v, ['turma', 'inicio', 'termino'], 8);
    if (hResumo < 0) return;
    const cr = indice_(v[hResumo]);

    const resumo = [];
    for (let i = hResumo + 1; i < v.length; i++) {
      const t = texto_(v[i][0]);
      if (!t) break;
      resumo.push({
        linha: i + 1,
        turma: t,
        inicio: iso_(data_(v[i][cr['inicio']])),
        fim: iso_(data_(v[i][cr['termino']])),
        prazoPlanejamento: iso_(data_(v[i][cr['prazo planejamento']])),
        prazoFinalizacao: iso_(data_(v[i][cr['prazo finalizacao']])),
        local: texto_(v[i][cr['local/unidade']]),
        formados: numero_(v[i][cr['formados']]),
        etapas: []
      });
    }

    const blocos = [];
    for (let i = hResumo + 1; i < v.length; i++) {
      const linha = v[i].map(x => semAcento_(x));
      if (linha[0] === 'fase' && linha.indexOf('etapa') >= 0 && linha.indexOf('status') >= 0) {
        blocos.push({ linhaCab: i, titulo: i > 0 ? texto_(v[i - 1][0]) : '', col: indice_(v[i]) });
      }
    }
    if (!blocos.length) return;
    if (blocos.length !== resumo.length) {
      avisos.push('Aba "' + nome + '": ' + resumo.length + ' turma(s) no resumo, mas ' + blocos.length + ' bloco(s) de etapas.');
    }

    blocos.forEach((b, k) => {
      const dono = resumo[k];
      if (!dono) return;
      dono.tituloLinha = b.linhaCab; // linha (1-based) do título "Turma | Período: ..."
      const col = b.col;
      const fim = k + 1 < blocos.length ? blocos[k + 1].linhaCab - 1 : v.length;
      for (let i = b.linhaCab + 1; i < fim; i++) {
        const r = v[i];
        const etapa = texto_(r[col['etapa']]);
        if (!etapa) continue;
        let prazo = data_(r[col['prazo sugerido']]);
        if (prazo && prazo.getFullYear() < 1950) {
          avisos.push('Aba "' + nome + '", linha ' + (i + 1) + ' ("' + etapa + '"): prazo inválido (' +
            texto_(prazo) + ') — a fórmula provavelmente aponta para uma célula vazia.');
          prazo = null;
        }
        dono.etapas.push({
          aba: nome,
          linha: i + 1,
          colEtapa: col['etapa'] + 1,
          colStatus: col['status'] + 1,
          colConclusao: col['data conclusao'] !== undefined ? col['data conclusao'] + 1 : null,
          fase: texto_(r[col['fase']]).toUpperCase(),
          prazo: iso_(prazo),
          etapa: etapa,
          status: texto_(r[col['status']]) || 'Pendente',
          responsavel: texto_(r[col['responsavel']]),
          observacoes: texto_(r[col['observacoes']]),
          documento: texto_(r[col['documento/comprovacao']]),
          conclusao: iso_(data_(r[col['data conclusao']]))
        });
      }
    });

    saida.push({ aba: nome, gid: aba.getSheetId(), turmas: resumo });
  });
  return saida;
}

/** "Formandos 2026": primeira tabela (Curso | Turma | Local | Formados). */
function lerFormandos_(ss) {
  const aba = abaFormandos_(ss);
  if (!aba) return [];
  const v = aba.getDataRange().getValues();
  const h = acharCabecalho_(v, ['curso', 'turma', 'formados'], 5);
  if (h < 0) return [];
  const c = indice_(v[h]);
  const out = [];
  for (let i = h + 1; i < v.length; i++) {
    const curso = texto_(v[i][c['curso']]);
    if (!curso) continue;
    out.push({
      linha: i + 1,
      curso: curso,
      turma: texto_(v[i][c['turma']]),
      local: texto_(v[i][c['local']]),
      formados: numero_(v[i][c['formados']]) || 0,
      matriculados: c['matriculados'] === undefined ? null : numero_(v[i][c['matriculados']])
    });
  }
  return out;
}

/**
 * Aba "Calendario" (modelo oficial): uma linha com o nome do mês, o cabeçalho
 * "Período | Treinamento | Qtd vagas | Local/Obs" e as linhas de treinamento.
 * O período pode vir como "17 a 18/09", "31/08 a 25/09" ou "15/10".
 */
function lerCalendario_(ss, avisos) {
  let aba = ss.getSheetByName(CONFIG.ABA_CALENDARIO);
  if (!aba) aba = ss.getSheets().find(s => semAcento_(s.getName()).indexOf('calendario') >= 0) || null;
  if (!aba) return [];
  const v = aba.getDataRange().getDisplayValues();
  const MESES = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

  let ano = new Date().getFullYear();
  for (let i = 0; i < Math.min(10, v.length); i++) {
    const m = v[i].join(' ').match(/\b(20\d{2})\b/);
    if (m) { ano = Number(m[1]); break; }
  }

  const out = [];
  let mes = -1, col = null;
  for (let i = 0; i < v.length; i++) {
    const r = v[i].map(x => String(x).trim());
    const cheias = r.filter(Boolean);
    if (!cheias.length) continue;
    const primeira = semAcento_(cheias[0]);
    if (cheias.length <= 2 && MESES.indexOf(primeira) >= 0) { mes = MESES.indexOf(primeira); continue; }
    const norm = r.map(x => semAcento_(x));
    if (norm.indexOf('periodo') >= 0 && norm.some(x => x.indexOf('treinamento') >= 0)) {
      col = {
        periodo: norm.indexOf('periodo'),
        treinamento: norm.findIndex(x => x.indexOf('treinamento') >= 0),
        vagas: norm.findIndex(x => x.indexOf('vagas') >= 0),
        local: norm.findIndex(x => x.indexOf('local') >= 0 || x.indexOf('obs') >= 0)
      };
      continue;
    }
    if (mes < 0 || !col) continue;
    const periodo = r[col.periodo], treinamento = r[col.treinamento];
    if (!periodo || !treinamento) continue;
    const datas = periodoParaDatas_(periodo, mes, ano);
    if (!datas) { avisos.push('Aba "' + aba.getName() + '", linha ' + (i + 1) + ': período "' + periodo + '" não reconhecido.'); }
    out.push({
      linha: i + 1,
      ano: ano,
      mes: mes,
      periodo: periodo,
      treinamento: treinamento,
      vagas: col.vagas >= 0 ? r[col.vagas] : '',
      local: col.local >= 0 ? r[col.local] : '',
      inicio: datas ? iso_(datas[0]) : null,
      fim: datas ? iso_(datas[1]) : null
    });
  }
  return out;
}

/** "17 a 18/09" | "31/08 a 25/09" | "15/10" | "05 a 28/10/2026" → [Date, Date] */
function periodoParaDatas_(txt, mes, ano) {
  const m = String(txt).replace(/\s+/g, ' ').match(/^(\d{1,2})(?:\/(\d{1,2}))?(?:\/(\d{2,4}))?(?:\s*(?:a|à|ate|até|-|–)\s*(\d{1,2})(?:\/(\d{1,2}))?(?:\/(\d{2,4}))?)?/i);
  if (!m) return null;
  const anoDe = x => x ? (x.length === 2 ? 2000 + Number(x) : Number(x)) : ano;
  const mesFim = m[5] ? Number(m[5]) - 1 : m[2] ? Number(m[2]) - 1 : mes;
  const mesIni = m[2] ? Number(m[2]) - 1 : mesFim;
  const fimAno = anoDe(m[6] || m[3]);
  const ini = new Date(anoDe(m[3] || m[6]), mesIni, Number(m[1]));
  const fim = m[4] ? new Date(fimAno, mesFim, Number(m[4])) : new Date(ini);
  return [ini, fim];
}

function lerRegras_(ss) {
  const aba = ss.getSheetByName(CONFIG.ABA_REGRAS);
  if (!aba) return [];
  const v = aba.getDataRange().getValues();
  const h = acharCabecalho_(v, ['codigo', 'prazo'], 5);
  if (h < 0) return [];
  const c = indice_(v[h]);
  const out = [];
  for (let i = h + 1; i < v.length; i++) {
    const cod = texto_(v[i][c['codigo']]);
    if (!/^R\d+/i.test(cod)) continue; // ignora as "notas de utilização"
    out.push({
      codigo: cod,
      etapa: texto_(v[i][c['etapa / regra']]),
      natureza: texto_(v[i][c['natureza']]),
      prazo: texto_(v[i][c['prazo']]),
      contagem: texto_(v[i][c['tipo de contagem']]),
      marco: texto_(v[i][c['marco de referencia']]),
      aplicabilidade: texto_(v[i][c['aplicabilidade']]),
      observacoes: texto_(v[i][c['observacoes']])
    });
  }
  return out;
}

function lerResponsaveis_(ss) {
  const aba = ss.getSheetByName(CONFIG.ABA_LISTAS);
  if (!aba) return [];
  const v = aba.getDataRange().getValues();
  const c = indice_(v[0])['responsaveis aet'];
  if (c === undefined) return [];
  return v.slice(1).map(r => texto_(r[c])).filter(Boolean);
}

function registrarHistorico_(ss, linha) {
  let aba = ss.getSheetByName(CONFIG.ABA_HISTORICO);
  if (!aba) {
    aba = ss.insertSheet(CONFIG.ABA_HISTORICO);
    aba.appendRow(['Data/hora', 'Usuário', 'Aba', 'Linha', 'Turma', 'Etapa', 'Antes / ação', 'Depois / detalhe']);
    aba.setFrozenRows(1);
    aba.getRange(1, 1, 1, 8).setFontWeight('bold');
  }
  aba.appendRow(linha);
}

/* ================================================================== */
/* Cache em blocos (CacheService aceita até 100 KB por chave)          */
/* ================================================================== */

const CACHE_PREFIXO_BASE = 'painel_v3_';

function gravarCache_(json, ano) {
  const CACHE_PREFIXO = prefixoCache_(ano);
  const cache = CacheService.getScriptCache();
  const tamanho = 90000;
  const partes = {};
  let n = 0;
  for (let i = 0; i < json.length; i += tamanho) {
    partes[CACHE_PREFIXO + n] = json.substring(i, i + tamanho);
    n++;
  }
  if (n > 50) return; // grande demais para valer a pena
  partes[CACHE_PREFIXO + 'n'] = String(n);
  cache.putAll(partes, CONFIG.CACHE_SEGUNDOS);
}

function lerCache_(ano) {
  const CACHE_PREFIXO = prefixoCache_(ano);
  const cache = CacheService.getScriptCache();
  const n = Number(cache.get(CACHE_PREFIXO + 'n'));
  if (!n) return null;
  const chaves = [];
  for (let i = 0; i < n; i++) chaves.push(CACHE_PREFIXO + i);
  const partes = cache.getAll(chaves);
  if (Object.keys(partes).length !== n) return null;
  return chaves.map(k => partes[k]).join('');
}

/** Limpa o cache de todos os anos (chamado após qualquer gravação). */
function limparCache() {
  const cache = CacheService.getScriptCache();
  const chaves = [];
  anosDisponiveis_().forEach(a => {
    const p = prefixoCache_(a);
    chaves.push(p + 'n');
    for (let i = 0; i < 50; i++) chaves.push(p + i);
  });
  cache.removeAll(chaves);
}

function prefixoCache_(ano) {
  return CACHE_PREFIXO_BASE + (ano || '') + '_';
}

/* ================================================================== */
/* Vários anos: uma planilha por ano, todas no mesmo painel            */
/* ================================================================== */

/** { "2027": "idDaPlanilha", ... } guardado nas propriedades do script. */
function anosRegistrados_() {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('ANOS') || '{}'); }
  catch (e) { return {}; }
}

function registrarAno_(ano, id) {
  const m = anosRegistrados_();
  m[ano] = id;
  PropertiesService.getScriptProperties().setProperty('ANOS', JSON.stringify(m));
}

/** O ano de uma planilha vem do nome do arquivo ("Controle de Cursos 2026"). */
function anoDaPlanilha_(ss) {
  const m = String(ss.getName()).match(/\b(20\d{2})\b/);
  return m ? Number(m[1]) : new Date().getFullYear();
}

/** Planilha do ano pedido (sem ano: a planilha onde o script está). */
function planilha_(ano) {
  const base = SpreadsheetApp.getActiveSpreadsheet();
  const alvo = Number(ano) || (base ? anoDaPlanilha_(base) : null);
  // Um ano cadastrado (ex.: a cópia reorganizada por unidade) tem prioridade sobre a planilha do script.
  const id = alvo ? anosRegistrados_()[alvo] : null;
  if (id && !(base && base.getId() === id)) return SpreadsheetApp.openById(id);
  if (base && (!ano || anoDaPlanilha_(base) === Number(ano))) return base;
  if (!base) throw new Error('Script sem planilha vinculada.');
  throw new Error('Não há planilha cadastrada para ' + ano + '.');
}

function anosDisponiveis_() {
  const anos = Object.keys(anosRegistrados_()).map(Number);
  const base = SpreadsheetApp.getActiveSpreadsheet();
  if (base) anos.push(anoDaPlanilha_(base));
  return Array.from(new Set(anos)).sort();
}

/** Aba de formandos: "Formandos 2026", "Formandos 2027"... */
function abaFormandos_(ss) {
  return ss.getSheetByName(CONFIG.ABA_FORMANDOS) ||
    ss.getSheets().find(s => /^formandos\b/.test(semAcento_(s.getName()))) || null;
}

/* ================================================================== */
/* Incluir turma nova (copia o checklist de uma turma modelo)          */
/* ================================================================== */

/**
 * Cria uma turma nova numa aba de curso, copiando o checklist da turma modelo:
 *  - linha no resumo da aba (as fórmulas de contagem apontam para o novo bloco);
 *  - bloco de etapas com prazos recalculados pelas datas novas;
 *  - linha no Cadastro de Turmas, no Painel Geral, em Formandos e no Calendario.
 */
function criarTurma(req) {
  return comTrava_(ss => {
    const nome = String(req.nome || '').trim();
    const local = String(req.local || '').trim();
    if (!nome) throw new Error('Informe o nome da turma.');
    if (!req.inicio || !req.fim) throw new Error('Informe início e término.');
    const ini = dataIso_(req.inicio), fim = dataIso_(req.fim);
    if (fim < ini) throw new Error('O término não pode ser antes do início.');

    const aba = abaOuErro_(ss, req.aba);
    const nomeAba = aba.getName();
    let v = aba.getDataRange().getValues();
    const h = acharCabecalho_(v, ['turma', 'inicio', 'termino'], 8);
    if (h < 0) throw new Error('Resumo de turmas não encontrado na aba ' + nomeAba + '.');
    const cr = indice_(v[h]);
    const larguraResumo = larguraCabecalho_(v[h]);
    const resumo = [];
    for (let i = h + 1; i < v.length && texto_(v[i][0]); i++) resumo.push(i + 1);
    if (resumo.some(l => chave_(texto_(v[l - 1][0])) === chave_(nome))) throw new Error('Já existe uma turma "' + nome + '" nesta aba.');
    const k = resumo.findIndex(l => chave_(texto_(v[l - 1][0])) === chave_(req.modelo));
    if (k < 0) throw new Error('Turma modelo "' + req.modelo + '" não encontrada na aba ' + nomeAba + '.');
    const tplRow = resumo[k];
    const ultimoResumo = resumo[resumo.length - 1];

    // 1) Linha nova no resumo (as fórmulas da planilha se ajustam sozinhas à inserção).
    aba.insertRowAfter(ultimoResumo);
    const R = ultimoResumo + 1;

    // 2) Bloco de etapas da turma modelo (posições relidas após a inserção).
    v = aba.getDataRange().getValues();
    const blocos = [];
    for (let i = R; i < v.length; i++) {
      const l = v[i].map(x => semAcento_(x));
      if (l[0] === 'fase' && l.indexOf('etapa') >= 0 && l.indexOf('status') >= 0) blocos.push(i + 1);
    }
    const cab = blocos[k];
    if (!cab) throw new Error('Bloco de etapas da turma modelo não encontrado.');
    const srcIni = cab - 1;
    const limite = k + 1 < blocos.length ? blocos[k + 1] - 2 : v.length;
    let srcFim = cab;
    for (let i = cab + 1; i <= limite; i++) if (v[i - 1].some(x => x !== '' && x !== null)) srcFim = i;
    const nLin = srcFim - srcIni + 1;
    const nCol = larguraCabecalho_(v[cab - 1]);
    const col = indice_(v[cab - 1]);

    const destIni = ultimaLinhaComDados_(v) + 3;
    const D = destIni - srcIni;
    if (aba.getMaxRows() < destIni + nLin) aba.insertRowsAfter(aba.getMaxRows(), destIni + nLin - aba.getMaxRows());
    const src = aba.getRange(srcIni, 1, nLin, nCol), dst = aba.getRange(destIni, 1, nLin, nCol);
    src.copyTo(dst, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
    src.copyTo(dst, SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION, false);

    const regras = [{ aba: null, de: tplRow, ate: tplRow, para: R }, { aba: null, de: srcIni, ate: srcFim, desloc: D }];
    const sv = src.getValues(), sf = src.getFormulas();
    const bloco = sv.map((row, i) => row.map((x, j) => {
      if (sf[i][j]) return reescreverFormula_(sf[i][j], nomeAba, regras);
      if (i > 1 && texto_(row[col['etapa']])) {
        if (j === col['status']) return x === 'Não se aplica' ? x : 'Pendente';
        if (j === col['data conclusao'] || j === col['observacoes']) return '';
      }
      return x;
    }));
    if (!sf[0][0]) bloco[0][0] = ' ' + nome + '  |  Período: ' + texto_(ini) + ' a ' + texto_(fim) + (local ? '  |  Local/Unidade: ' + local : '');
    dst.setValues(bloco);

    // 3) Linha do resumo: mesmas fórmulas da modelo, apontando para o novo bloco.
    const tpl = aba.getRange(tplRow, 1, 1, larguraResumo);
    tpl.copyTo(aba.getRange(R, 1, 1, larguraResumo), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
    const tv = tpl.getValues()[0], tf = tpl.getFormulas()[0];
    const linha = tv.map((x, j) => tf[j] ? reescreverFormula_(tf[j], nomeAba, regras) : x);
    linha[cr['turma']] = nome;
    if (!tf[cr['inicio']]) linha[cr['inicio']] = ini;
    if (!tf[cr['termino']]) linha[cr['termino']] = fim;
    if (cr['local/unidade'] !== undefined && !tf[cr['local/unidade']]) linha[cr['local/unidade']] = local;
    if (cr['formados'] !== undefined && !tf[cr['formados']]) linha[cr['formados']] = '';
    aba.getRange(R, 1, 1, larguraResumo).setValues([linha]);

    // 4) Cadastro de Turmas, Painel Geral, Formandos e Calendario.
    const cad = incluirNoCadastro_(ss, nomeAba, tplRow, R, req);
    incluirNoPainelGeral_(ss, nomeAba, tplRow, R, cad);
    incluirEmFormandos_(ss, req.curso || nomeAba, nome, req.cidade || local, req.matriculados);
    incluirNoCalendario_(ss, ini, fim, req.treinamento || nome, req.vagas, local);

    historico_(ss, nomeAba, R, nome, '', 'Turma incluída', texto_(ini) + ' a ' + texto_(fim) + ' · modelo: ' + req.modelo);
    return { ok: true, linha: R };
  }, req.ano);
}

function incluirNoCadastro_(ss, nomeAba, tplRow, R, req) {
  const c = cadastro_(ss);
  const v = c.aba.getDataRange().getValues();
  const h = acharCabecalho_(v, ['id', 'curso', 'turma'], 6);
  const largura = larguraCabecalho_(v[h]);
  let tpl = -1, ultimo = h + 1, maxId = 0;
  for (let i = h + 1; i < v.length; i++) {
    if (!texto_(v[i][c.col['turma']]) && !texto_(v[i][c.col['id']])) continue;
    ultimo = i + 1;
    maxId = Math.max(maxId, numero_(v[i][c.col['id']]) || 0);
    if (chave_(texto_(v[i][c.col['turma']])) === chave_(req.modelo)) tpl = i + 1;
  }
  if (tpl < 0) return null; // modelo fora do cadastro: segue sem esta linha
  c.aba.insertRowAfter(ultimo);
  const nova = ultimo + 1;
  const src = c.aba.getRange(tpl, 1, 1, largura);
  src.copyTo(c.aba.getRange(nova, 1, 1, largura), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  src.copyTo(c.aba.getRange(nova, 1, 1, largura), SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION, false);
  const regras = [{ aba: null, de: tpl, ate: tpl, para: nova }, { aba: nomeAba, de: tplRow, ate: tplRow, para: R }];
  const sv = src.getValues()[0], sf = src.getFormulas()[0];
  const linha = sv.map((x, j) => sf[j] ? reescreverFormula_(sf[j], c.aba.getName(), regras) : x);
  const col = c.col;
  linha[col['id']] = maxId + 1;
  if (!sf[col['turma']]) linha[col['turma']] = req.nome;
  if (col['local/unidade'] !== undefined && !sf[col['local/unidade']]) linha[col['local/unidade']] = req.local || '';
  if (col['inicio'] !== undefined && !sf[col['inicio']]) linha[col['inicio']] = dataIso_(req.inicio);
  if (col['termino'] !== undefined && !sf[col['termino']]) linha[col['termino']] = dataIso_(req.fim);
  if (col['observacoes'] !== undefined) linha[col['observacoes']] = '';
  if (col['situacao temporal'] !== undefined && !sf[col['situacao temporal']]) {
    const fI = letra_(col['inicio'] + 1) + nova, fT = letra_(col['termino'] + 1) + nova;
    linha[col['situacao temporal']] = '=IF(TODAY()<' + fI + ',"Planejamento",IF(TODAY()<=' + fT + ',"Em execução","Encerrado"))';
  }
  c.aba.getRange(nova, 1, 1, largura).setValues([linha]);
  if (req.unidade) c.aba.getRange(nova, colunaUnidade_(c) + 1).setValue(req.unidade);
  if (req.cursoOficial) c.aba.getRange(nova, colunaCadastro_(c, 'curso (sige)', 'Curso (SiGE)') + 1).setValue(req.cursoOficial);
  if (req.cidade) c.aba.getRange(nova, colunaCadastro_(c, 'cidade', 'Cidade') + 1).setValue(req.cidade);
  return { tpl: tpl, nova: nova, aba: c.aba.getName() };
}

function incluirNoPainelGeral_(ss, nomeAba, tplRow, R, cad) {
  const aba = ss.getSheets().find(s => CONFIG.ABAS_IGNORADAS.indexOf(s.getName()) >= 0);
  if (!aba) return;
  const v = aba.getDataRange().getValues(), f = aba.getDataRange().getFormulas();
  const h = acharCabecalho_(v, ['curso', 'turma', 'inicio'], 6);
  if (h < 0) return;
  const largura = larguraCabecalho_(v[h]);
  const alvo = new RegExp("(^|[^A-Za-z0-9_])'?" + nomeAba.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "'?!\\$?[A-Z]{1,3}\\$?" + tplRow + '(?!\\d)');
  let tpl = -1, ultimo = h + 1;
  for (let i = h + 1; i < v.length; i++) {
    if (!v[i].some(x => x !== '' && x !== null) && !f[i].some(Boolean)) continue;
    ultimo = i + 1;
    if (f[i].some(x => alvo.test(x))) tpl = i + 1;
  }
  if (tpl < 0) return;
  aba.insertRowAfter(ultimo);
  const nova = ultimo + 1;
  const src = aba.getRange(tpl, 1, 1, largura);
  src.copyTo(aba.getRange(nova, 1, 1, largura), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  const regras = [{ aba: null, de: tpl, ate: tpl, para: nova }, { aba: nomeAba, de: tplRow, ate: tplRow, para: R }];
  if (cad) regras.push({ aba: cad.aba, de: cad.tpl, ate: cad.tpl, para: cad.nova });
  const sv = src.getValues()[0], sf = src.getFormulas()[0];
  aba.getRange(nova, 1, 1, largura).setValues([sv.map((x, j) => sf[j] ? reescreverFormula_(sf[j], aba.getName(), regras) : x)]);
}

function incluirEmFormandos_(ss, curso, turma, local, matriculados) {
  const aba = abaFormandos_(ss);
  if (!aba) return;
  const v = aba.getDataRange().getValues();
  const h = acharCabecalho_(v, ['curso', 'turma', 'formados'], 5);
  if (h < 0) return;
  const c = indice_(v[h]);
  let ultimo = -1;
  for (let i = h + 1; i < v.length; i++) if (texto_(v[i][c['curso']])) ultimo = i + 1;
  if (ultimo < 0) return;
  // Insere ANTES da última linha para que os intervalos dos totais (SUMIF) se expandam.
  aba.insertRowBefore(ultimo);
  const largura = c['formados'] + 1;
  aba.getRange(ultimo + 1, 1, 1, largura).copyTo(aba.getRange(ultimo, 1, 1, largura), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  const linha = new Array(largura).fill('');
  linha[c['curso']] = curso; linha[c['turma']] = turma;
  if (c['local'] !== undefined) linha[c['local']] = local;
  linha[c['formados']] = 0;
  aba.getRange(ultimo, 1, 1, largura).setValues([linha]);
  const n = Number(matriculados);
  if (matriculados !== '' && matriculados != null && n >= 0) aba.getRange(ultimo, colunaMatriculados_(aba, h, v[h]) + 1).setValue(Math.round(n));
}

function incluirNoCalendario_(ss, ini, fim, treinamento, vagas, local) {
  const aba = ss.getSheetByName(CONFIG.ABA_CALENDARIO) || ss.getSheets().find(s => semAcento_(s.getName()).indexOf('calendario') >= 0);
  if (!aba) return;
  const v = aba.getDataRange().getDisplayValues();
  const MESES = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const mes = ini.getMonth();
  const mesmoMes = ini.getMonth() === fim.getMonth();
  const dd = d => ('0' + d.getDate()).slice(-2), mm = d => ('0' + (d.getMonth() + 1)).slice(-2);
  const periodo = ini.getTime() === fim.getTime() ? dd(ini) + '/' + mm(ini)
    : mesmoMes ? dd(ini) + ' a ' + dd(fim) + '/' + mm(fim) : dd(ini) + '/' + mm(ini) + ' a ' + dd(fim) + '/' + mm(fim);

  // Blocos do calendário: { mes, titulo, cab, ultimo, col }.
  const blocos = [];
  for (let i = 0; i < v.length; i++) {
    const r = v[i].map(x => String(x).trim()), cheias = r.filter(Boolean);
    if (!cheias.length) continue;
    const m = MESES.indexOf(semAcento_(cheias[0]));
    if (cheias.length <= 2 && m >= 0) { blocos.push({ mes: m, titulo: i + 1, cab: -1, ultimo: -1, col: null }); continue; }
    const b = blocos[blocos.length - 1];
    if (!b) continue;
    const n = r.map(x => semAcento_(x));
    if (b.cab < 0 && n.indexOf('periodo') >= 0) { b.cab = i + 1; b.col = n; continue; }
    if (b.cab > 0) b.ultimo = i + 1;
  }
  const colunas = n => ({ periodo: n.indexOf('periodo'), treinamento: n.findIndex(x => x.indexOf('treinamento') >= 0), vagas: n.findIndex(x => x.indexOf('vagas') >= 0), local: n.findIndex(x => x.indexOf('local') >= 0 || x.indexOf('obs') >= 0) });
  const largura = aba.getLastColumn();
  const montar = c => { const l = new Array(largura).fill(''); l[c.periodo] = periodo; l[c.treinamento] = treinamento; if (c.vagas >= 0) l[c.vagas] = vagas ? String(vagas) : '-'; if (c.local >= 0) l[c.local] = local; return l; };

  const doMes = blocos.find(b => b.mes === mes && b.cab > 0);
  if (doMes) {
    const depois = doMes.ultimo > 0 ? doMes.ultimo : doMes.cab;
    aba.insertRowAfter(depois);
    if (doMes.ultimo > 0) aba.getRange(doMes.ultimo, 1, 1, largura).copyTo(aba.getRange(depois + 1, 1, 1, largura), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
    aba.getRange(depois + 1, 1, 1, largura).setValues([montar(colunas(doMes.col))]);
    return;
  }
  // Mês ainda sem bloco: cria no fim, copiando a formatação do primeiro mês.
  const modelo = blocos.find(b => b.cab > 0);
  if (!modelo) return;
  const base = ultimaLinhaComDados_(v) + 2;
  aba.getRange(modelo.titulo, 1, 3, largura).copyTo(aba.getRange(base, 1, 3, largura), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  const cabecalho = v[modelo.cab - 1].slice(0, largura);
  const titulo = new Array(largura).fill(''); titulo[0] = MESES_TITULO_[mes];
  aba.getRange(base, 1, 3, largura).setValues([titulo, cabecalho, montar(colunas(cabecalho.map(x => semAcento_(x))))]);
}

const MESES_TITULO_ = ['JANEIRO', 'FEVEREIRO', 'MARÇO', 'ABRIL', 'MAIO', 'JUNHO', 'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO'];

/* ================================================================== */
/* Criar o ano seguinte: cópia "espelho" da planilha                   */
/* ================================================================== */

/**
 * Copia a planilha do ano de origem para o ano seguinte, mantendo cursos,
 * turmas, locais, vagas e checklists. Avança as datas, zera status
 * (exceto "Não se aplica"), datas de conclusão, observações das etapas,
 * formados e histórico. A planilha de origem não é alterada.
 *  req.modoDatas: 'semana' (mesmo dia da semana, +364 dias) | 'data' (mesmo dia e mês)
 *  req.canceladas: 'manter' | 'reativar'
 */
function criarAnoSeguinte(req) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const origem = planilha_(req.ano);
    const anoOrigem = anoDaPlanilha_(origem), novoAno = anoOrigem + 1;
    if (anosRegistrados_()[novoAno]) throw new Error('A planilha de ' + novoAno + ' já existe.');
    const avancar = d => {
      const n = new Date(d.getTime());
      if (req.modoDatas === 'data') n.setFullYear(n.getFullYear() + 1);
      else n.setDate(n.getDate() + 364);
      return n;
    };

    const arquivo = DriveApp.getFileById(origem.getId());
    const pastas = arquivo.getParents();
    const nome = /\b20\d{2}\b/.test(origem.getName()) ? origem.getName().replace(/\b20\d{2}\b/, String(novoAno)) : origem.getName() + ' ' + novoAno;
    const copia = pastas.hasNext() ? arquivo.makeCopy(nome, pastas.next()) : arquivo.makeCopy(nome);
    const ss = SpreadsheetApp.openById(copia.getId());

    const af = abaFormandos_(ss);
    const fixas = [CONFIG.ABA_CADASTRO, af ? af.getName() : '', CONFIG.ABA_REGRAS, CONFIG.ABA_LISTAS, CONFIG.ABA_HISTORICO, CONFIG.ABA_CALENDARIO, CONFIG.ABA_RESOLUCAO].concat(CONFIG.ABAS_IGNORADAS);

    ss.getSheets().forEach(aba => {
      const nomeAba = aba.getName();
      // Títulos com o ano ("... AET/CPE 2026") nas primeiras linhas.
      trocarAnoNosTitulos_(aba, anoOrigem, novoAno);
      if (fixas.indexOf(nomeAba) >= 0) return;

      const v = aba.getDataRange().getValues();
      const h = acharCabecalho_(v, ['turma', 'inicio', 'termino'], 8);
      if (h < 0) return;

      // Etapas: status, conclusão e observações por coluna de cada bloco.
      const cabs = [];
      for (let i = h + 1; i < v.length; i++) {
        const l = v[i].map(x => semAcento_(x));
        if (l[0] === 'fase' && l.indexOf('etapa') >= 0 && l.indexOf('status') >= 0) cabs.push(i);
      }
      cabs.forEach((i, idx) => {
        const col = indice_(v[i]);
        const fim = idx + 1 < cabs.length ? cabs[idx + 1] - 1 : v.length; // exclusivo: para antes do título do próximo bloco
        const n = fim - (i + 1);
        if (n <= 0) return;
        const colStatus = v.slice(i + 1, fim).map(r => [texto_(r[col['etapa']]) ? (r[col['status']] === 'Não se aplica' ? 'Não se aplica' : 'Pendente') : r[col['status']]]);
        escreverColuna_(aba, i + 2, col['status'] + 1, colStatus);
        if (col['data conclusao'] !== undefined) escreverColuna_(aba, i + 2, col['data conclusao'] + 1, colStatus.map(() => ['']));
        if (col['observacoes'] !== undefined) escreverColuna_(aba, i + 2, col['observacoes'] + 1, colStatus.map(() => ['']));
      });

      // Datas digitadas (sem fórmula): resumo, linhas avulsas e quadros auxiliares.
      const v2 = aba.getDataRange().getValues(), f2 = aba.getDataRange().getFormulas();
      for (let i = 0; i < v2.length; i++) {
        for (let j = 0; j < v2[i].length; j++) {
          if (v2[i][j] instanceof Date && !f2[i][j] && v2[i][j].getFullYear() > 1950) aba.getRange(i + 1, j + 1).setValue(avancar(v2[i][j]));
        }
      }

      // Formados do resumo e títulos "Período: dd/mm/aaaa a dd/mm/aaaa" dos blocos.
      const v3 = aba.getDataRange().getValues();
      const cr = indice_(v3[h]);
      const resumo = [];
      for (let i = h + 1; i < v3.length && texto_(v3[i][0]); i++) resumo.push(i);
      if (cr['formados'] !== undefined) resumo.forEach(i => { const c = aba.getRange(i + 1, cr['formados'] + 1); if (!c.getFormula()) c.setValue(''); });
      let k = 0;
      for (let i = h + 1; i < v3.length; i++) {
        const l = v3[i].map(x => semAcento_(x));
        if (!(l[0] === 'fase' && l.indexOf('etapa') >= 0)) continue;
        const r = resumo[k++];
        if (r === undefined || i < 1) continue;
        const celT = aba.getRange(i, 1);
        const t = String(celT.getValue()), re = /Per[ií]odo:\s*\d{2}\/\d{2}\/\d{4}(\s*a\s*\d{2}\/\d{2}\/\d{4})?/;
        if (!celT.getFormula() && re.test(t)) celT.setValue(t.replace(re, 'Período: ' + texto_(v3[r][cr['inicio']]) + ' a ' + texto_(v3[r][cr['termino']])));
      }
    });

    // Cadastro: canceladas (manter ou reativar) e observações limpas.
    const cad = cadastro_(ss);
    const cv = cad.aba.getDataRange().getValues();
    const hc = acharCabecalho_(cv, ['id', 'curso', 'turma'], 6);
    for (let i = hc + 1; i < cv.length; i++) {
      if (!texto_(cv[i][cad.col['turma']])) continue;
      const cel = cad.aba.getRange(i + 1, cad.col['situacao temporal'] + 1);
      const cancelada = !cel.getFormula() && /cancel/i.test(String(cel.getValue()));
      if (cancelada && req.canceladas === 'reativar') {
        const nota = cel.getNote();
        const fI = letra_(cad.col['inicio'] + 1) + (i + 1), fT = letra_(cad.col['termino'] + 1) + (i + 1);
        cel.setFormula(nota.indexOf(NOTA_FORMULA) === 0 ? nota.substring(NOTA_FORMULA.length).trim()
          : '=IF(TODAY()<' + fI + ',"Planejamento",IF(TODAY()<=' + fT + ',"Em execução","Encerrado"))');
        cel.clearNote();
      }
      const obs = cad.aba.getRange(i + 1, cad.col['observacoes'] + 1);
      if (!obs.getFormula() && !(cancelada && req.canceladas !== 'reativar')) obs.setValue('');
      // Turmas desmarcadas no formulário (fora da Resolução do ano novo) já nascem canceladas.
      if ((req.cancelar || []).indexOf(i + 1) >= 0 && !(cancelada && req.canceladas !== 'reativar')) {
        const f = cel.getFormula();
        if (f) cel.setNote(NOTA_FORMULA + f);
        cel.setValue('Cancelado');
        if (!obs.getFormula()) obs.setValue('Não prevista na Resolução ' + novoAno + '.');
      }
    }

    // Formandos: nome da aba e quantidades zeradas.
    if (af) {
      if (/\b20\d{2}\b/.test(af.getName())) af.setName(af.getName().replace(/\b20\d{2}\b/, String(novoAno)));
      const fv = af.getDataRange().getValues();
      const hf = acharCabecalho_(fv, ['curso', 'turma', 'formados'], 5);
      if (hf >= 0) {
        const c = indice_(fv[hf]);
        for (let i = hf + 1; i < fv.length; i++) {
          if (!texto_(fv[i][c['curso']])) continue;
          const cel = af.getRange(i + 1, c['formados'] + 1);
          if (!cel.getFormula()) cel.setValue(0);
        }
        // Matriculados: estimativa da Resolução do ano novo (alunos ÷ turmas), editável depois.
        const est = req.matriculados || {};
        if (Object.keys(est).length) {
          const colM = colunaMatriculados_(af, hf, fv[hf]);
          for (let i = hf + 1; i < fv.length; i++) {
            if (!texto_(fv[i][c['curso']])) continue;
            const n = est[i + 1];
            af.getRange(i + 1, colM + 1).setValue(n == null ? '' : n);
          }
        }
      }
    }

    avancarCalendario_(ss, avancar, novoAno);

    // Histórico do painel começa vazio no ano novo.
    const hist = ss.getSheetByName(CONFIG.ABA_HISTORICO);
    if (hist && hist.getLastRow() > 1) hist.deleteRows(2, hist.getLastRow() - 1);

    registrarAno_(novoAno, ss.getId());
    SpreadsheetApp.flush();
    limparCache();
    historico_(origem, CONFIG.ABA_CADASTRO, '', '', '', 'Ano ' + novoAno + ' criado', ss.getUrl());
    return JSON.stringify({ ok: true, ano: novoAno, url: ss.getUrl(), nome: ss.getName() });
  } finally {
    lock.releaseLock();
  }
}

/** Calendario: avança os períodos ("17 a 18/09") e o ano do título. */
function avancarCalendario_(ss, avancar, novoAno) {
  const aba = ss.getSheetByName(CONFIG.ABA_CALENDARIO) || ss.getSheets().find(s => semAcento_(s.getName()).indexOf('calendario') >= 0);
  if (!aba) return;
  const v = aba.getDataRange().getDisplayValues(), f = aba.getDataRange().getFormulas();
  const MESES = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const dd = d => ('0' + d.getDate()).slice(-2), mm = d => ('0' + (d.getMonth() + 1)).slice(-2);
  let mes = -1, cp = -1;
  for (let i = 0; i < v.length; i++) {
    const r = v[i].map(x => String(x).trim()), cheias = r.filter(Boolean);
    if (!cheias.length) continue;
    const m = MESES.indexOf(semAcento_(cheias[0]));
    if (cheias.length <= 2 && m >= 0) { mes = m; continue; }
    const n = r.map(x => semAcento_(x));
    if (n.indexOf('periodo') >= 0) { cp = n.indexOf('periodo'); continue; }
    if (mes < 0 || cp < 0 || !r[cp] || f[i][cp]) continue;
    const datas = periodoParaDatas_(r[cp], mes, novoAno - 1);
    if (!datas) continue;
    const a = avancar(datas[0]), b = avancar(datas[1]);
    const txt = a.getTime() === b.getTime() ? dd(a) + '/' + mm(a)
      : a.getMonth() === b.getMonth() ? dd(a) + ' a ' + dd(b) + '/' + mm(b) : dd(a) + '/' + mm(a) + ' a ' + dd(b) + '/' + mm(b);
    aba.getRange(i + 1, cp + 1).setValue(txt);
  }
}

function trocarAnoNosTitulos_(aba, de, para) {
  const n = Math.min(aba.getLastRow(), 10), c = aba.getLastColumn();
  if (n < 1 || c < 1) return;
  const r = aba.getRange(1, 1, n, c), v = r.getValues(), f = r.getFormulas();
  for (let i = 0; i < n; i++) for (let j = 0; j < c; j++) {
    if (!f[i][j] && typeof v[i][j] === 'string' && v[i][j].indexOf(String(de)) >= 0 && /[A-Za-zÀ-ú]/.test(v[i][j])) {
      aba.getRange(i + 1, j + 1).setValue(v[i][j].split(String(de)).join(String(para)));
    }
  }
}

/* ---------- utilitários das inclusões ---------- */

/** Escreve uma coluna de valores, sem tocar nas células que têm fórmula. */
function escreverColuna_(aba, linha, coluna, valores) {
  const r = aba.getRange(linha, coluna, valores.length, 1);
  const f = r.getFormulas();
  if (f.every(x => !x[0])) { r.setValues(valores); return; }
  valores.forEach((x, i) => { if (!f[i][0]) aba.getRange(linha + i, coluna).setValue(x[0]); });
}

/** Quantas colunas tem um cabeçalho (até a primeira célula vazia depois da coluna A). */
function larguraCabecalho_(linha) {
  let n = 0;
  for (let j = 0; j < linha.length; j++) { if (texto_(linha[j])) n = j + 1; else if (j > 0) break; }
  return Math.max(n, 1);
}

function ultimaLinhaComDados_(v) {
  for (let i = v.length - 1; i >= 0; i--) if (v[i].some(x => x !== '' && x !== null)) return i + 1;
  return 0;
}

/**
 * Reescreve referências de linha (A1) numa fórmula.
 * Cada regra: { aba: null (a própria aba) | 'Nome', de, ate, para | desloc }.
 * Textos entre aspas não são alterados.
 */
function reescreverFormula_(formula, abaAtual, regras) {
  const partes = String(formula).split('"');
  const limpa = n => String(n || '').replace(/^'|'$/g, '');
  for (let p = 0; p < partes.length; p += 2) { // índices pares = fora de aspas
    partes[p] = partes[p].replace(/((?:'[^']+'|[A-Za-zÀ-ú0-9_]+)!)?(\$?)([A-Z]{1,3})(\$?)(\d+)(?![\d(A-Za-z_])/g, (m, aba, d1, c, d2, lin, pos, str) => {
      const antes = pos > 0 ? str[pos - 1] : '';
      if (!aba && /[A-Za-z0-9_.$]/.test(antes)) return m;
      const nomeRef = aba ? limpa(aba.slice(0, -1)) : null;
      const mesma = !nomeRef || nomeRef === abaAtual;
      const n = Number(lin);
      for (const r of regras) {
        const casa = r.aba === null ? mesma : nomeRef === r.aba || (mesma && r.aba === abaAtual);
        if (casa && n >= r.de && n <= r.ate) {
          const novo = r.para !== undefined ? r.para : n + r.desloc;
          return (aba || '') + d1 + c + d2 + novo;
        }
      }
      return m;
    });
  }
  return partes.join('"');
}

/* ================================================================== */
/* Resolução (cursos aprovados no SiGE)                                */
/* ================================================================== */

// Estágio de Pilotagem Policial: Condução Defensiva, Condução 4x4 e
// Deslocamento de Comboio são executados juntos, numa mesma turma.
const GRUPO_EPP = 'Estágio de Pilotagem Policial (EPP)';

// Dados iniciais da aba "Resolução" (copiados do SiGE). Depois de criada,
// a aba é a fonte: edite lá para incluir anos ou corrigir números.
const RESOLUCAO_INICIAL = [
  // ano, ID SiGE, curso, grupo no painel, unidade, turmas, alunos, status
  [2026, 9388, 'Curso de Identificação Veicular e Documental', '', 'BPMRv', 4, 160, 'Em curso'],
  [2026, 9391, 'Curso de Policiamento de Guardas', '', 'BPGd', 1, 30, 'Cancelado'],
  [2026, 9597, 'Curso de Radiopatrulhamento Tático Rodoviário', '', 'BPMRv', 1, 38, 'Pendente de conclusão'],
  [2026, 9614, 'Curso de Capacitação do Grupo Especial de Policiamento Ambiental - GEPAM', '', 'BPM MAmb', 1, 40, 'Pendente de conclusão'],
  [2026, 9623, 'Estágio de Condução Defensiva de Viaturas', GRUPO_EPP, 'BPMRv', 4, 71, 'Em curso'],
  [2026, 9624, 'Estágio de Condução 4x4', GRUPO_EPP, 'BPMRv', 4, 75, 'Em curso'],
  [2026, 9625, 'Curso de Fiscalização de Transporte Terrestre de Produtos Perigosos e Atendimento a Sinistros (PP)', '', 'BPMRv', 4, 155, 'Em curso'],
  [2026, 9634, 'Estágio Tático Rodoviário', '', 'BPMRv', 4, 152, 'Em curso'],
  [2026, 9639, 'Curso de Policiamento de Meio Ambiente', '', 'BPM MAmb', 1, 50, 'Autorizado pelo comando'],
  [2026, 9640, 'Curso de Capacitação de Mediadores do Programa de Educação Ambiental - PROGEA', '', 'BPM MAmb', 1, 37, 'Pendente de conclusão'],
  [2026, 9646, 'Curso de Policiamento Rodoviário', '', 'BPMRv', 2, 88, 'Em curso'],
  [2026, 9651, 'Curso de Pilotagem Policial', '', 'BPMRv', 2, 48, 'Em curso'],
  [2026, 9654, 'Credenciamento ao Uso Operacional de Armas Portáteis de Alta Energia', '', 'BPMRv', 2, 53, 'Em curso'],
  [2026, 9786, 'Estágio de Deslocamento de Comboio', GRUPO_EPP, 'BPMRv', 4, 67, 'Em curso'],
  [2027, 11850, 'Curso de Policiamento Rodoviário', '', 'BPMRv', 1, 40, 'Aguardando análise'],
  [2027, 11851, 'Estágio Tático Rodoviário', '', 'BPMRv', 2, 60, 'Aguardando análise'],
  [2027, 11852, 'Estágio de Condução Defensiva de Viaturas', GRUPO_EPP, 'BPMRv', 2, 42, 'Aguardando análise'],
  [2027, 11853, 'Estágio de Deslocamento de Comboio', GRUPO_EPP, 'BPMRv', 2, 42, 'Aguardando análise'],
  [2027, 11854, 'Estágio de Condução 4x4', GRUPO_EPP, 'BPMRv', 2, 42, 'Aguardando análise'],
  [2027, 11855, 'Credenciamento ao Uso Operacional de Armas Portáteis de Alta Energia', '', 'BPMRv', 2, 80, 'Aguardando análise'],
  [2027, 11856, 'Curso de Credenciamento para o Serviço de Policiamento Velado', '', 'BPMRv', 1, 30, 'Aguardando análise'],
  [2027, 11857, 'Curso de Capacitação do Grupo Especial de Policiamento Ambiental - GEPAM', '', 'BPM MAmb', 1, 40, 'Aguardando análise'],
  [2027, 11867, 'Curso de Identificação Veicular e Documental', '', 'BPMRv', 4, 120, 'Aguardando análise'],
  [2027, 11869, 'Curso de Radiopatrulhamento Tático Rodoviário', '', 'BPMRv', 1, 40, 'Aguardando análise'],
  [2027, 11870, 'Curso de Pilotagem Policial', '', 'BPMRv', 1, 24, 'Aguardando análise'],
  [2027, 11871, 'Curso de Fiscalização de Transporte Terrestre de Produtos Perigosos e Atendimento a Sinistros (PP)', '', 'BPMRv', 1, 30, 'Aguardando análise'],
  [2027, 11872, 'Curso de Policiamento de Meio Ambiente', '', 'BPM MAmb', 1, 40, 'Aguardando análise'],
  [2027, 11873, 'Curso de Capacitação de Mediadores do Programa de Educação Ambiental - PROGEA', '', 'BPM MAmb', 1, 30, 'Aguardando análise']
];

/** Lê a aba "Resolução" (cria com os dados iniciais na primeira vez). */
function lerResolucao_(ss) {
  let aba = ss.getSheetByName(CONFIG.ABA_RESOLUCAO);
  if (!aba) {
    aba = ss.insertSheet(CONFIG.ABA_RESOLUCAO);
    const cab = ['Ano', 'ID SiGE', 'Curso', 'Grupo no painel', 'Unidade', 'Turmas', 'Alunos', 'Status'];
    aba.getRange(1, 1, 1, cab.length).setValues([cab]).setFontWeight('bold').setBackground('#1f3864').setFontColor('#ffffff');
    aba.getRange(2, 1, RESOLUCAO_INICIAL.length, cab.length).setValues(RESOLUCAO_INICIAL);
    aba.setFrozenRows(1);
    aba.setColumnWidth(3, 520); aba.setColumnWidth(4, 260); aba.setColumnWidth(8, 200);
  }
  const v = aba.getDataRange().getValues();
  const h = acharCabecalho_(v, ['ano', 'curso', 'turmas'], 5);
  if (h < 0) return [];
  const c = indice_(v[h]);
  const out = [];
  for (let i = h + 1; i < v.length; i++) {
    const curso = nomeCurso_(v[i][c['curso']]);
    const ano = numero_(v[i][c['ano']]);
    if (!curso || !ano) continue;
    out.push({
      ano: ano,
      id: texto_(v[i][c['id sige']]).replace(/\.0$/, ''),
      curso: curso,
      grupo: nomeCurso_(v[i][c['grupo no painel']]) || curso,
      unidade: texto_(v[i][c['unidade']]).replace(/\/CPE$/i, ''),
      turmas: numero_(v[i][c['turmas']]) || 0,
      alunos: numero_(v[i][c['alunos']]) || 0,
      status: texto_(v[i][c['status']])
    });
  }
  return out;
}

/** Nome do curso sem o ano da matriz curricular ("... 2022 atualizada" → "..."). */
function nomeCurso_(s) {
  return texto_(s).replace(/^[-–\s]+/, '').replace(/\s+\b(19|20)\d{2}\b.*$/, '').replace(/\s+atualizad[oa]s?\s*$/i, '').trim();
}

/** Curso (grupo da Resolução) sugerido pelo nome/curso da turma, quando a coluna "Curso (SiGE)" está vazia. */
function grupoPadrao_(txt) {
  const t = semAcento_(txt);
  const regras = [
    [/\bivd\b|identificacao veicular/, 'Curso de Identificação Veicular e Documental'],
    [/crtr|radiopatrulhamento/, 'Curso de Radiopatrulhamento Tático Rodoviário'],
    [/ceptr|policiamento rodoviario/, 'Curso de Policiamento Rodoviário'],
    [/estagio tatico|\betr\b/, 'Estágio Tático Rodoviário'],
    [/estagio de pilotagem|\bepp\b|conducao|comboio|4x4/, GRUPO_EPP],
    [/pilotagem|\bcpp\b/, 'Curso de Pilotagem Policial'],
    [/produtos perigosos|\bpp\b/, 'Curso de Fiscalização de Transporte Terrestre de Produtos Perigosos e Atendimento a Sinistros (PP)'],
    [/alta energia|armas portateis/, 'Credenciamento ao Uso Operacional de Armas Portáteis de Alta Energia'],
    [/velado/, 'Curso de Credenciamento para o Serviço de Policiamento Velado'],
    [/gepam/, 'Curso de Capacitação do Grupo Especial de Policiamento Ambiental - GEPAM'],
    [/progea|educacao ambiental/, 'Curso de Capacitação de Mediadores do Programa de Educação Ambiental - PROGEA'],
    [/meio ambiente|ambiental/, 'Curso de Policiamento de Meio Ambiente'],
    [/guarda/, 'Curso de Policiamento de Guardas']
  ];
  for (const [re, nome] of regras) if (re.test(t)) return nome;
  return '';
}

/** Cidade sugerida: o que vem depois do " - " no nome da turma, ou o local (se não for unidade). */
function cidadePadrao_(turma, local) {
  const naoCidade = /turma|\bbpm|\bcpe\b|bpgd|ambiente|interior|semad|convenio|\bcia\b|^\s*$/i;
  const partes = String(turma).split(/\s[-–]\s/);
  const cand = [partes.length > 1 ? partes[partes.length - 1] : '', local];
  for (const c of cand) if (c && !naoCidade.test(semAcento_(c))) return c.trim();
  return '';
}

/**
 * Preenche, no Cadastro de Turmas, as colunas "Curso (SiGE)" e "Cidade"
 * que estiverem vazias com a sugestão do painel (nome oficial do curso,
 * sem o ano da matriz curricular). Não altera o que já foi preenchido.
 */
function preencherCursos(aplicar, ano) {
  const ss = ano && typeof ano === 'object' ? ano : planilha_(ano); // menu: a planilha aberta
  const cad = cadastro_(ss);
  const v = cad.aba.getDataRange().getValues();
  const h = acharCabecalho_(v, ['id', 'curso', 'turma'], 6);
  const c = cad.col, out = [];
  for (let i = h + 1; i < v.length; i++) {
    const turma = texto_(v[i][c['turma']]);
    if (!turma) continue;
    const curso = c['curso (sige)'] !== undefined ? texto_(v[i][c['curso (sige)']]) : '';
    const cidade = c['cidade'] !== undefined ? texto_(v[i][c['cidade']]) : '';
    const sCurso = curso ? '' : grupoPadrao_([v[i][c['curso']], turma].join(' '));
    const sCidade = cidade ? '' : cidadePadrao_(turma, texto_(v[i][c['local/unidade']]));
    if (sCurso || sCidade) out.push({ linha: i + 1, turma: turma, curso: sCurso, cidade: sCidade });
  }
  if (aplicar && out.length) {
    const colC = colunaCadastro_(cad, 'curso (sige)', 'Curso (SiGE)'), colD = colunaCadastro_(cad, 'cidade', 'Cidade');
    out.forEach(x => {
      if (x.curso) cad.aba.getRange(x.linha, colC + 1).setValue(x.curso);
      if (x.cidade) cad.aba.getRange(x.linha, colD + 1).setValue(x.cidade);
    });
    historico_(ss, CONFIG.ABA_CADASTRO, '', '', '', 'Curso (SiGE) e cidade preenchidos', out.length + ' turma(s)');
    SpreadsheetApp.flush();
    limparCache();
  }
  return out.map(x => x.turma + ' → ' + [x.curso, x.cidade].filter(Boolean).join(' · '));
}

function preencherCursosUi() {
  const ui = SpreadsheetApp.getUi();
  const lista = preencherCursos(false, SpreadsheetApp.getActiveSpreadsheet());
  if (!lista.length) return ui.alert('Curso (SiGE) e cidade', 'Todas as turmas já estão preenchidas.', ui.ButtonSet.OK);
  const ok = ui.alert('Curso (SiGE) e cidade', lista.length + ' turma(s) receberão a sugestão (as vazias; o resto fica como está):\n\n' + lista.join('\n') + '\n\nAplicar?', ui.ButtonSet.YES_NO);
  if (ok !== ui.Button.YES) return;
  preencherCursos(true, SpreadsheetApp.getActiveSpreadsheet());
  ui.alert('Curso (SiGE) e cidade', '✓ Preenchido. Confira as colunas no fim do Cadastro de Turmas e atualize o painel.', ui.ButtonSet.OK);
}

/* ================================================================== */
/* Reorganização por unidade executora                                 */
/* ================================================================== */

/**
 * Cria uma CÓPIA da planilha com uma aba por unidade executora (BPMRv,
 * BPM MAmb, BPGd...) no lugar das abas por curso. Em cada aba: o resumo de
 * todas as turmas da unidade em ordem de data e, abaixo, o bloco de etapas
 * de cada turma na mesma ordem. Fórmulas, formatos e listas são levados
 * junto; Cadastro de Turmas e Painel Geral passam a apontar para as abas
 * novas. A planilha original não é alterada.
 * Com req.registrar, o painel passa a ler a cópia para este ano.
 */
function reorganizarPorUnidade(req) {
  req = req || {};
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const origem = req.planilha || planilha_(req.ano);
    const ano = anoDaPlanilha_(origem);
    const arquivo = DriveApp.getFileById(origem.getId());
    const pastas = arquivo.getParents();
    const nome = origem.getName().replace(/\s*\(por unidade\)\s*$/i, '') + ' (por unidade)';
    const copia = pastas.hasNext() ? arquivo.makeCopy(nome, pastas.next()) : arquivo.makeCopy(nome);
    const ss = SpreadsheetApp.openById(copia.getId());

    corrigirReferencias(true, ss); // referências tortas viram #REF ao mover; acerta antes
    const r = reorganizar_(ss, ano);
    // Correções de cadastro na planilha nova: curso do SiGE, cidade e responsáveis padronizados.
    r.cursos = preencherCursos(true, ss).length;
    r.responsaveis = padronizarResponsaveis(true, ss).total;

    if (req.registrar) registrarAno_(ano, ss.getId());
    SpreadsheetApp.flush();
    limparCache();
    historico_(ss, '', '', '', '', 'Planilha reorganizada por unidade', 'cópia de ' + origem.getName());
    return JSON.stringify(Object.assign({ ok: true, url: ss.getUrl(), nome: ss.getName(), ano: ano }, r));
  } finally {
    lock.releaseLock();
  }
}

/**
 * Mesmo que o menu "Criar planilha nova", para rodar direto do editor do
 * Apps Script (escolha criarPlanilhaNova e clique em Executar). O link da
 * planilha nova aparece no Registro de execução.
 */
function criarPlanilhaNova() {
  const r = JSON.parse(reorganizarPorUnidade({ planilha: SpreadsheetApp.getActiveSpreadsheet(), registrar: true }));
  Logger.log('✓ Planilha nova criada: ' + r.nome + '\n' + r.url + '\n' +
    r.abas.map(a => a.aba + ': ' + a.turmas + ' turma(s)').join(' · ') + ' · etapas: ' + r.etapasDepois);
  return r.url;
}

function reorganizarPorUnidadeUi() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ok = ui.alert('Reorganizar por unidade',
    'Será criada uma CÓPIA desta planilha com uma aba por unidade executora (' + CONFIG.UNIDADES.join(', ') + '), ' +
    'turmas em ordem de data, cada uma com seu checklist completo.\n\n' +
    'Na cópia também são corrigidos: datas de etapas que apontavam para outra turma, curso (SiGE) e cidade das turmas, ' +
    'e responsáveis das etapas (só a equipe da aba Listas, com lista de seleção).\n\n' +
    'Esta planilha não é alterada. O painel passa a abrir a cópia para ' + anoDaPlanilha_(ss) + '.\n\n' +
    'Leva cerca de 1 minuto. Continuar?', ui.ButtonSet.YES_NO);
  if (ok !== ui.Button.YES) return;
  const r = JSON.parse(reorganizarPorUnidade({ planilha: ss, registrar: true }));
  ui.alert('Reorganizar por unidade', '✓ Criada: ' + r.nome + '\n\n' +
    r.abas.map(a => '• ' + a.aba + ': ' + a.turmas + ' turma(s)').join('\n') +
    '\n\nEtapas: ' + r.etapasDepois + ' (antes ' + r.etapasAntes + ')' +
    '\nCurso (SiGE)/cidade preenchidos: ' + r.cursos + ' turma(s) · responsáveis corrigidos: ' + r.responsaveis + ' etapa(s)' +
    (r.semUnidade.length ? '\n\nAtenção — confira: ' + r.semUnidade.join(', ') : '') +
    '\n\nAbra pelo link (também em Arquivo › Abrir recentes):\n' + r.url, ui.ButtonSet.OK);
}

function reorganizar_(ss, ano) {
  const af = abaFormandos_(ss);
  const fixas = [CONFIG.ABA_CADASTRO, af ? af.getName() : CONFIG.ABA_FORMANDOS, CONFIG.ABA_REGRAS, CONFIG.ABA_LISTAS,
    CONFIG.ABA_HISTORICO, CONFIG.ABA_CALENDARIO, CONFIG.ABA_RESOLUCAO].concat(CONFIG.ABAS_IGNORADAS);
  const etapasAntes = lerAbasOperacionais_(ss, []).reduce((n, op) => n + op.turmas.reduce((m, t) => m + t.etapas.length, 0), 0);

  // Unidade de cada turma (Cadastro; sem cadastro: regra padrão).
  const unidadeDe = {};
  lerCadastro_(ss, []).forEach(t => { unidadeDe[chave_(t.turma)] = t.unidade; });

  // 1) Abas por curso: resumo e blocos de etapas.
  const fontes = {}, turmas = [], semUnidade = [];
  ss.getSheets().forEach(aba => {
    const nome = aba.getName();
    if (fixas.indexOf(nome) >= 0) return;
    const rng = aba.getDataRange(), v = rng.getValues(), f = rng.getFormulas();
    const h = acharCabecalho_(v, ['turma', 'inicio', 'termino'], 8);
    if (h < 0) return;
    const resumo = [];
    for (let i = h + 1; i < v.length && texto_(v[i][0]); i++) resumo.push(i + 1);
    const cabs = [];
    for (let i = h + 1; i < v.length; i++) {
      const l = v[i].map(x => semAcento_(x));
      if (l[0] === 'fase' && l.indexOf('etapa') >= 0 && l.indexOf('status') >= 0) cabs.push(i + 1);
    }
    if (!cabs.length) return;
    const ultima = ultimaLinhaComDados_(v);
    const blocos = cabs.map((cab, k) => ({ ini: cab - 1, fim: k + 1 < cabs.length ? cabs[k + 1] - 2 : ultima, larg: larguraCabecalho_(v[cab - 1]) }));
    const fonte = { aba: aba, nome: nome, v: v, f: f, h: h, resumo: resumo, blocos: blocos, larg: larguraCabecalho_(v[h]), alvo: {} };
    fontes[nome] = fonte;
    resumo.forEach((lin, k) => {
      if (!blocos[k]) return;
      const t = texto_(v[lin - 1][0]);
      turmas.push({
        fonte: fonte, k: k, linha: lin, nome: t, inicio: data_(v[lin - 1][1]),
        unidade: unidadeDe[chave_(t)] || unidadePadrao_('', nome, t)
      });
    });
    if (resumo.length > blocos.length) semUnidade.push(nome + ' (' + (resumo.length - blocos.length) + ' turma(s) sem bloco de etapas)');
  });
  if (!turmas.length) throw new Error('Nenhuma aba de curso com turmas encontrada.');

  // 2) Posições novas: uma aba por unidade, turmas por data.
  const unidades = CONFIG.UNIDADES.slice();
  turmas.forEach(t => { if (unidades.indexOf(t.unidade) < 0) unidades.push(t.unidade); });
  const plano = [];
  unidades.forEach(u => {
    const ts = turmas.filter(t => t.unidade === u).sort((a, b) => (a.inicio ? a.inicio.getTime() : 9e15) - (b.inicio ? b.inicio.getTime() : 9e15));
    if (!ts.length) return;
    const tab = { unidade: u, nome: ss.getSheetByName(u) ? u + ' (unidade)' : u, turmas: ts };
    let cursor = 4 + ts.length + 3;
    ts.forEach((t, i) => {
      t.novaAba = tab.nome;
      t.novoResumo = 4 + i;
      const b = t.fonte.blocos[t.k];
      t.novoIni = cursor;
      t.fonte.alvo[t.linha] = { aba: tab.nome, linha: t.novoResumo };
      for (let r = b.ini; r <= b.fim; r++) t.fonte.alvo[r] = { aba: tab.nome, linha: cursor + (r - b.ini) };
      cursor += (b.fim - b.ini + 1) + 2;
    });
    plano.push(tab);
  });

  // Linha antiga → nova. Fora do mapa (ex.: título da aba): sem destino.
  const destino = (aba, linha) => fontes[aba] ? fontes[aba].alvo[linha] || null : undefined;
  const q = n => /^[A-Za-z_][A-Za-z0-9_]*$/.test(n) ? n : "'" + n.replace(/'/g, "''") + "'";

  /** Reescreve referências de uma fórmula que estava em `abaOrigem` e vai morar em `abaDestino`. */
  function remapear(formula, abaOrigem, abaDestino) {
    const partes = String(formula).split('"');
    for (let p = 0; p < partes.length; p += 2) {
      let ultima = null;
      partes[p] = partes[p].replace(/((?:'(?:[^']|'')+'|[A-Za-zÀ-ú0-9_]+)!)?(\$?)([A-Z]{1,3})(\$?)(\d+)(?![\d(A-Za-z_])/g, (m, aba, d1, c, d2, lin, pos, str) => {
        const antes = pos > 0 ? str[pos - 1] : '';
        if (!aba && /[A-Za-z0-9_.$]/.test(antes)) return m;
        const fimDeIntervalo = !aba && antes === ':';
        const src = aba ? aba.slice(0, -1).replace(/^'|'$/g, '').replace(/''/g, "'") : fimDeIntervalo && ultima ? ultima.src : abaOrigem;
        const d = destino(src, Number(lin));
        let abaNova = src, linNova = lin;
        if (d) { abaNova = d.aba; linNova = d.linha; }
        else if (fimDeIntervalo && ultima && ultima.d) { abaNova = ultima.d.aba; linNova = Number(lin) + (ultima.d.linha - ultima.lin); }
        ultima = { src: src, d: d || null, lin: Number(lin) };
        const prefixo = fimDeIntervalo ? '' : abaNova === abaDestino ? '' : q(abaNova) + '!';
        return prefixo + d1 + c + d2 + linNova;
      });
    }
    return partes.join('"');
  }

  // 3) Abas novas.
  const primeira = Math.min.apply(null, Object.keys(fontes).map(n => ss.getSheets().indexOf(fontes[n].aba)));
  const resultado = [];
  plano.forEach((tab, idx) => {
    const nova = ss.insertSheet(tab.nome, primeira + idx);
    const f0 = tab.turmas[0].fonte;
    const larg = Math.max.apply(null, tab.turmas.map(t => t.fonte.larg));
    const largBloco = Math.max.apply(null, tab.turmas.map(t => t.fonte.blocos[t.k].larg));
    const largTotal = Math.max(larg, largBloco);
    const ultimaLinha = tab.turmas[tab.turmas.length - 1];
    const precisa = ultimaLinha.novoIni + (ultimaLinha.fonte.blocos[ultimaLinha.k].fim - ultimaLinha.fonte.blocos[ultimaLinha.k].ini) + 5;
    if (nova.getMaxRows() < precisa) nova.insertRowsAfter(nova.getMaxRows(), precisa - nova.getMaxRows());
    if (nova.getMaxColumns() < largTotal) nova.insertColumnsAfter(nova.getMaxColumns(), largTotal - nova.getMaxColumns());
    for (let c = 1; c <= largTotal; c++) { try { nova.setColumnWidth(c, f0.aba.getColumnWidth(c)); } catch (e) { /* largura padrão */ } }

    // título e cabeçalho do resumo
    f0.aba.getRange(1, 1, 3, larg).copyTo(nova.getRange(1, 1, 3, larg), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
    nova.getRange(1, 1).setValue('CONTROLE DE TURMAS - ' + tab.unidade + ' - AET/CPE ' + ano);
    nova.getRange(3, 1, 1, larg).setValues([f0.v[f0.h].slice(0, larg).concat(new Array(Math.max(0, larg - f0.v[f0.h].length)).fill(''))]);

    tab.turmas.forEach(t => {
      const fo = t.fonte, b = fo.blocos[t.k];
      // linha do resumo
      const lr = fo.larg;
      fo.aba.getRange(t.linha, 1, 1, lr).copyTo(nova.getRange(t.novoResumo, 1, 1, lr), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
      fo.aba.getRange(t.linha, 1, 1, lr).copyTo(nova.getRange(t.novoResumo, 1, 1, lr), SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION, false);
      nova.getRange(t.novoResumo, 1, 1, lr).setValues([fo.v[t.linha - 1].slice(0, lr).map((x, j) => fo.f[t.linha - 1][j] ? remapear(fo.f[t.linha - 1][j], fo.nome, tab.nome) : x)]);
      // bloco de etapas
      const n = b.fim - b.ini + 1, lb = b.larg;
      const src = fo.aba.getRange(b.ini, 1, n, lb), dst = nova.getRange(t.novoIni, 1, n, lb);
      src.copyTo(dst, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
      src.copyTo(dst, SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION, false);
      const vals = [];
      for (let i = 0; i < n; i++) {
        const r = b.ini - 1 + i;
        vals.push(new Array(lb).fill('').map((_, j) => {
          const fx = (fo.f[r] || [])[j], vx = (fo.v[r] || [])[j];
          return fx ? remapear(fx, fo.nome, tab.nome) : (vx === undefined || vx === null ? '' : vx);
        }));
      }
      dst.setValues(vals);
    });
    try { nova.setFrozenRows(0); } catch (e) { /* ok */ }
    resultado.push({ aba: tab.nome, turmas: tab.turmas.length });
  });

  // 4) Demais abas (Cadastro, Painel Geral...): referências às abas antigas.
  const nomesAntigos = Object.keys(fontes);
  const contem = f => nomesAntigos.some(n => f.indexOf(n + '!') >= 0 || f.indexOf("'" + n.replace(/'/g, "''") + "'!") >= 0);
  ss.getSheets().forEach(aba => {
    const nome = aba.getName();
    if (fontes[nome] || plano.some(t => t.nome === nome)) return;
    const rng = aba.getDataRange(), f = rng.getFormulas();
    f.forEach((linha, i) => linha.forEach((fx, j) => {
      if (!fx || !contem(fx)) return;
      const novo = remapear(fx, nome, nome);
      if (novo !== fx) aba.getRange(i + 1, j + 1).setFormula(novo);
    }));
  });
  // Coluna "Aba operacional" do Cadastro: link para a aba nova.
  try {
    const cad = cadastro_(ss);
    if (cad.col['aba operacional'] !== undefined) {
      const cv = cad.aba.getDataRange().getValues();
      const hc = acharCabecalho_(cv, ['id', 'curso', 'turma'], 6);
      for (let i = hc + 1; i < cv.length; i++) {
        const t = turmas.find(x => chave_(x.nome) === chave_(texto_(cv[i][cad.col['turma']])));
        if (!t) continue;
        const aba = ss.getSheetByName(t.novaAba);
        if (aba) cad.aba.getRange(i + 1, cad.col['aba operacional'] + 1).setFormula('=HYPERLINK("#gid=' + aba.getSheetId() + '&range=A' + t.novoResumo + '","Abrir")');
      }
    }
  } catch (e) { /* sem Cadastro: segue */ }

  // 5) Remove as abas antigas por curso.
  nomesAntigos.forEach(n => ss.deleteSheet(fontes[n].aba));

  SpreadsheetApp.flush();
  const etapasDepois = lerAbasOperacionais_(ss, []).reduce((n, op) => n + op.turmas.reduce((m, t) => m + t.etapas.length, 0), 0);
  return { abas: resultado, etapasAntes: etapasAntes, etapasDepois: etapasDepois, removidas: nomesAntigos, semUnidade: semUnidade };
}

/* ================================================================== */
/* Responsáveis (equipe da seção)                                      */
/* ================================================================== */

/** Índice (0-based) da coluna "Responsáveis AET" da aba Listas (cria aba/coluna se faltar). */
function colunaResponsaveisListas_(ss) {
  let aba = ss.getSheetByName(CONFIG.ABA_LISTAS);
  if (!aba) { aba = ss.insertSheet(CONFIG.ABA_LISTAS); aba.getRange(1, 1).setValue('Responsáveis AET'); return 0; }
  const cab = aba.getRange(1, 1, 1, Math.max(aba.getLastColumn(), 1)).getValues()[0];
  const c = indice_(cab)['responsaveis aet'];
  if (c !== undefined) return c;
  const nova = larguraCabecalho_(cab);
  aba.getRange(1, nova + 1).setValue('Responsáveis AET');
  return nova;
}

/**
 * Nome da equipe correspondente a um texto livre: "Flávia", "Sgt Flavia",
 * "Coordenação/Flávia" → "Sgt Flávia". Compara pelo nome (última palavra),
 * sem acento. Quem não é da equipe ("AET", "Coordenação"...) → vazio.
 */
function responsavelPadrao_(txt, equipe) {
  const t = ' ' + semAcento_(txt).replace(/[^a-z0-9]+/g, ' ') + ' ';
  if (!t.trim()) return '';
  for (const nome of equipe) {
    if (semAcento_(nome) === semAcento_(txt)) return nome;
  }
  const achados = equipe.filter(nome => {
    const partes = semAcento_(nome).split(/\s+/);
    return t.indexOf(' ' + partes[partes.length - 1] + ' ') >= 0;
  });
  return achados.length === 1 ? achados[0] : '';
}

/** Colunas Responsável de todos os blocos de etapas: [{aba, linha, n, col}] */
function colunasResponsavel_(ss) {
  const af = abaFormandos_(ss);
  const fixas = [CONFIG.ABA_CADASTRO, af ? af.getName() : CONFIG.ABA_FORMANDOS, CONFIG.ABA_REGRAS, CONFIG.ABA_LISTAS,
    CONFIG.ABA_HISTORICO, CONFIG.ABA_CALENDARIO, CONFIG.ABA_RESOLUCAO].concat(CONFIG.ABAS_IGNORADAS);
  const out = [];
  ss.getSheets().forEach(aba => {
    if (fixas.indexOf(aba.getName()) >= 0) return;
    const v = aba.getDataRange().getValues();
    const cabs = [];
    for (let i = 0; i < v.length; i++) {
      const l = v[i].map(x => semAcento_(x));
      if (l[0] === 'fase' && l.indexOf('etapa') >= 0 && l.indexOf('status') >= 0) cabs.push(i);
    }
    cabs.forEach((i, k) => {
      const col = indice_(v[i]);
      if (col['responsavel'] === undefined) return;
      const fim = k + 1 < cabs.length ? cabs[k + 1] - 1 : ultimaLinhaComDados_(v);
      let ultimo = i;
      for (let r = i + 1; r < fim; r++) if (texto_(v[r][col['etapa']])) ultimo = r;
      if (ultimo > i) out.push({ aba: aba, nome: aba.getName(), linha: i + 2, n: ultimo - i, col: col['responsavel'], colObs: col['observacoes'],
        obs: col['observacoes'] === undefined ? [] : v.slice(i + 1, ultimo + 1).map(r => r[col['observacoes']]), valores: v.slice(i + 1, ultimo + 1).map(r => r[col['responsavel']]), etapas: v.slice(i + 1, ultimo + 1).map(r => texto_(r[col['etapa']])) });
    });
  });
  return out;
}

/** Lista de seleção (só a equipe da aba Listas) nas colunas Responsável. */
function validacaoResponsaveis_(ss) {
  const colL = colunaResponsaveisListas_(ss);
  const listas = ss.getSheetByName(CONFIG.ABA_LISTAS);
  const intervalo = listas.getRange(2, colL + 1, 30, 1);
  const regra = SpreadsheetApp.newDataValidation().requireValueInRange(intervalo, true).setAllowInvalid(false)
    .setHelpText('Escolha um integrante da seção (lista na aba Listas).').build();
  colunasResponsavel_(ss).forEach(b => b.aba.getRange(b.linha, b.col + 1, b.n, 1).setDataValidation(regra));
}

/**
 * Padroniza a coluna Responsável das etapas para os nomes da equipe.
 * Variações ("Flávia", "Sgt Flavia") viram o nome da lista; o que não é
 * da equipe ("AET", "Coordenação"...) fica vazio para ser definido.
 */
function padronizarResponsaveis(aplicar, ano) {
  const ss = ano && typeof ano === 'object' ? ano : planilha_(ano);
  const equipe = lerResponsaveis_(ss);
  if (!equipe.length) throw new Error('A aba Listas não tem a coluna "Responsáveis AET" preenchida.');
  const trocas = {};
  let total = 0;
  const blocos = colunasResponsavel_(ss);
  blocos.forEach(b => {
    b.novos = b.valores.map((x, i) => {
      if (!b.etapas[i]) return x;
      const atual = texto_(x), novo = atual ? responsavelPadrao_(atual, equipe) : '';
      if (novo !== atual) { const k = atual + ' → ' + (novo || '(vazio)'); trocas[k] = (trocas[k] || 0) + 1; total++; }
      return novo;
    });
  });
  if (aplicar) {
    blocos.forEach(b => {
      const rng = b.aba.getRange(b.linha, b.col + 1, b.n, 1);
      rng.clearDataValidations();
      rng.setValues(b.novos.map(x => [x]));
      // Quem não é da equipe (ex.: "Coordenação/SAT") fica anotado nas observações da etapa; "AET" (a própria seção) só sai.
      if (b.colObs === undefined) return;
      let mudou = false;
      const obs = b.valores.map((x, i) => {
        const antigo = texto_(x), o = texto_(b.obs[i]);
        if (!b.etapas[i] || !antigo || b.novos[i] || /^aet$/i.test(antigo) || o.indexOf('Responsável anterior:') >= 0) return [b.obs[i]];
        mudou = true;
        return [(o ? o + ' · ' : '') + 'Responsável anterior: ' + antigo];
      });
      if (mudou) b.aba.getRange(b.linha, b.colObs + 1, b.n, 1).setValues(obs);
    });
    validacaoResponsaveis_(ss);
    if (total) historico_(ss, '', '', '', '', 'Responsáveis padronizados', Object.keys(trocas).map(k => k + ' (' + trocas[k] + ')').join('; '));
    SpreadsheetApp.flush();
    limparCache();
  }
  return { total: total, trocas: trocas, equipe: equipe };
}

function padronizarResponsaveisUi() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const r = padronizarResponsaveis(false, ss);
  const linhas = Object.keys(r.trocas).sort().map(k => k + '  (' + r.trocas[k] + ')');
  const ok = ui.alert('Padronizar responsáveis',
    'Equipe (aba Listas): ' + r.equipe.join(', ') + '\n\n' +
    (r.total ? r.total + ' etapa(s) mudam:\n' + linhas.join('\n') + '\n\n' : 'Os nomes já estão padronizados.\n\n') +
    'A coluna Responsável passa a ter lista de seleção só com a equipe. Aplicar?', ui.ButtonSet.YES_NO);
  if (ok !== ui.Button.YES) return;
  padronizarResponsaveis(true, ss);
  ui.alert('Padronizar responsáveis', '✓ Pronto. Para incluir alguém novo na seção, acrescente o nome na aba Listas (coluna Responsáveis AET) ou pelo painel (botão Equipe).', ui.ButtonSet.OK);
}

/* ================================================================== */
/* Correção das referências das etapas                                 */
/* ================================================================== */

/**
 * Em cada bloco de etapas, Início, Término e Prazo sugerido devem apontar
 * para a linha da própria turma no resumo do topo da aba (ex.: =B5, =C5,
 * =B5-25). Linhas copiadas/inseridas costumam "andar" a referência para a
 * turma vizinha ou para uma linha vazia (o prazo vira 1899).
 * Com aplicar=false só lista o que mudaria.
 */
function corrigirReferencias(aplicar, ano) {
  const ss = ano && typeof ano === 'object' ? ano : planilha_(ano); // menu: a planilha aberta
  const af = abaFormandos_(ss);
  const fixas = [CONFIG.ABA_CADASTRO, af ? af.getName() : CONFIG.ABA_FORMANDOS, CONFIG.ABA_REGRAS, CONFIG.ABA_LISTAS, CONFIG.ABA_HISTORICO, CONFIG.ABA_CALENDARIO, CONFIG.ABA_RESOLUCAO]
    .concat(CONFIG.ABAS_IGNORADAS);
  const correcoes = [], manuais = [];

  ss.getSheets().forEach(aba => {
    const nome = aba.getName();
    if (fixas.indexOf(nome) >= 0) return;
    const rng = aba.getDataRange(), v = rng.getValues(), f = rng.getFormulas();
    const hResumo = acharCabecalho_(v, ['turma', 'inicio', 'termino'], 8);
    if (hResumo < 0) return;
    const cr = indice_(v[hResumo]);
    if (cr['inicio'] === undefined || cr['termino'] === undefined) return;

    const resumo = [];
    for (let i = hResumo + 1; i < v.length && texto_(v[i][0]); i++) resumo.push(i + 1);
    const blocos = [];
    for (let i = hResumo + 1; i < v.length; i++) {
      const linha = v[i].map(x => semAcento_(x));
      if (linha[0] === 'fase' && linha.indexOf('etapa') >= 0 && linha.indexOf('status') >= 0) blocos.push({ linhaCab: i, col: indice_(v[i]) });
    }
    if (!blocos.length || blocos.length !== resumo.length) {
      if (blocos.length) manuais.push(nome + ': ' + resumo.length + ' turma(s) no resumo e ' + blocos.length + ' bloco(s) — confira manualmente.');
      return;
    }
    // área do resumo: da 1ª turma até a linha antes do 1º bloco (inclui as linhas vazias)
    const areaIni = hResumo + 2, areaFim = blocos[0].linhaCab - 1;
    const letraIni = letra_(cr['inicio'] + 1), letraFim = letra_(cr['termino'] + 1);

    blocos.forEach((b, k) => {
      const R = resumo[k], col = b.col;
      const fimBloco = k + 1 < blocos.length ? blocos[k + 1].linhaCab - 1 : v.length;
      const regras = [{ aba: null, de: areaIni, ate: areaFim, para: R }];
      for (let i = b.linhaCab + 1; i < fimBloco; i++) {
        const etapa = texto_(v[i][col['etapa']]);
        if (!etapa) continue;
        [['inicio', '=' + letraIni + R], ['termino', '=' + letraFim + R], ['prazo sugerido', null]].forEach(([chave, padrao]) => {
          const c = col[chave];
          if (c === undefined) return;
          const atual = f[i][c];
          let nova = null;
          if (atual && padrao && /^=\$?[A-Z]{1,3}\$?\d+$/.test(atual)) nova = padrao; // =B6 → =B5
          else if (atual && new RegExp('^=\\$?(' + letraIni + '|' + letraFim + ')\\$?\\d+\\s*[+-]\\s*\\d+$').test(atual)) nova = atual.replace(/\d+(?=\s*[+-])/, String(R)); // =B6-25 → =B5-25
          else if (atual) nova = reescreverFormula_(atual, nome, regras);
          else if (padrao) nova = padrao;
          else if (v[i][c] !== '') manuais.push(nome + '!' + letra_(c + 1) + (i + 1) + ' ("' + etapa + '"): prazo digitado (' + texto_(v[i][c]) + '); use =' + letraIni + R + '-dias.');
          if (!nova || nova === atual) return;
          correcoes.push({ aba: aba, nome: nome, cel: letra_(c + 1) + (i + 1), linha: i + 1, etapa: etapa, de: atual || texto_(v[i][c]), para: nova });
        });
      }
    });
  });

  if (aplicar && correcoes.length) {
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      correcoes.forEach(x => {
        x.aba.getRange(x.cel).setFormula(x.para);
        historico_(ss, x.nome, x.linha, '', x.etapa, 'Correção de referência', x.cel + ': ' + x.de + ' → ' + x.para);
      });
      SpreadsheetApp.flush();
      limparCache();
    } finally {
      lock.releaseLock();
    }
  }
  return {
    correcoes: correcoes.map(x => x.nome + '!' + x.cel + ' ("' + x.etapa + '"): ' + x.de + ' → ' + x.para),
    manuais: manuais
  };
}

function corrigirReferenciasUi() {
  const ui = SpreadsheetApp.getUi();
  const r = corrigirReferencias(false, SpreadsheetApp.getActiveSpreadsheet());
  const extra = r.manuais.length ? '\n\nCorrigir à mão:\n' + r.manuais.join('\n') : '';
  if (!r.correcoes.length) return ui.alert('Datas das etapas', 'Nenhuma referência errada encontrada.' + extra, ui.ButtonSet.OK);
  const ok = ui.alert('Datas das etapas', r.correcoes.length + ' célula(s) serão corrigidas:\n\n' + r.correcoes.join('\n') + extra + '\n\nAplicar?', ui.ButtonSet.YES_NO);
  if (ok !== ui.Button.YES) return;
  corrigirReferencias(true, SpreadsheetApp.getActiveSpreadsheet());
  ui.alert('Datas das etapas', '✓ ' + r.correcoes.length + ' célula(s) corrigidas. Atualize o painel.', ui.ButtonSet.OK);
}

/* ================================================================== */
/* Utilitários                                                         */
/* ================================================================== */

/** Procura, nas primeiras `max` linhas, a que contém todos os rótulos. */
function acharCabecalho_(v, rotulos, max) {
  for (let i = 0; i < Math.min(max, v.length); i++) {
    const linha = v[i].map(x => semAcento_(x));
    if (rotulos.every(r => linha.indexOf(r) >= 0)) return i;
  }
  return -1;
}

/** { 'rotulo sem acento': índiceDaColuna } — primeira ocorrência vence. */
function indice_(linha) {
  const m = {};
  linha.forEach((h, i) => {
    const k = semAcento_(h);
    if (k && m[k] === undefined) m[k] = i;
  });
  return m;
}

function semAcento_(s) {
  return String(s == null ? '' : s)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Chave de comparação de nomes de turma (ignora acento, travessão, espaços). */
function chave_(s) {
  return semAcento_(s).replace(/[–—]/g, '-').replace(/\s*-\s*/g, '-');
}

function texto_(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'dd/MM/yyyy');
  return String(v).trim();
}

function numero_(v) {
  if (typeof v === 'number') return v;
  if (v === '' || v == null) return null;
  const n = parseFloat(String(v).replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, ''));
  return isNaN(n) ? null : n;
}

function data_(v) {
  if (v instanceof Date && !isNaN(v)) return v;
  const s = String(v || '').trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) return new Date(m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return null;
}

/** Data → "yyyy-MM-dd" no fuso do script (evita perder um dia). */
function iso_(d) {
  return d ? Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd') : null;
}

function usuario_() {
  try { return Session.getActiveUser().getEmail() || 'desconhecido'; } catch (e) { return 'desconhecido'; }
}

/* ================================================================== */
/* Diagnóstico                                                         */
/* ================================================================== */

/** Rode pelo editor (ou pelo menu) para conferir o que foi lido. */
function diagnosticar() {
  const d = montarDados_();
  const porAba = {};
  d.etapas.forEach(e => { porAba[e.aba] = (porAba[e.aba] || 0) + 1; });
  const linhas = [
    'Turmas: ' + d.turmas.length,
    'Etapas: ' + d.etapas.length,
    ...Object.keys(porAba).map(a => '  • ' + a + ': ' + porAba[a] + ' etapas'),
    'Formandos (linhas): ' + d.formandos.length,
    'Regras: ' + d.regras.length,
    'Responsáveis: ' + d.responsaveis.join(', ')
  ];
  if (d.avisos.length) linhas.push('', 'Avisos:', ...d.avisos.map(a => '  ⚠ ' + a));
  const txt = linhas.join('\n');
  Logger.log(txt);
  return txt;
}

function diagnosticarUi() {
  SpreadsheetApp.getUi().alert('Diagnóstico da leitura', diagnosticar(), SpreadsheetApp.getUi().ButtonSet.OK);
}
