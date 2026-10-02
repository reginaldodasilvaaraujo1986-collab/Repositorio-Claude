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
  ABA_HISTORICO: 'Histórico Painel',

  // Abas que nunca são tratadas como operacionais.
  ABAS_IGNORADAS: ['Painel Geral'],

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
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle(CONFIG.TITULO)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(nome) {
  return HtmlService.createHtmlOutputFromFile(nome).getContent();
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('📊 Painel')
    .addItem('Abrir painel', 'abrirPainel')
    .addItem('Diagnóstico da leitura', 'diagnosticarUi')
    .addSeparator()
    .addItem('Limpar cache', 'limparCache')
    .addToUi();
}

/** Qualquer edição manual invalida o cache para o painel refletir a planilha. */
function onEdit() {
  limparCache();
}

function abrirPainel() {
  const html = HtmlService.createTemplateFromFile('Index').evaluate()
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
function getDadosPainel(forcar) {
  if (!forcar) {
    const emCache = lerCache_();
    if (emCache) return emCache;
  }
  const json = JSON.stringify(montarDados_());
  gravarCache_(json);
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
  const lock = LockService.getDocumentLock();
  lock.waitLock(15000);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
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

/* ================================================================== */
/* Montagem dos dados                                                  */
/* ================================================================== */

function montarDados_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const avisos = [];

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
    url: ss.getUrl(),
    geradoEm: new Date().toISOString(),
    hoje: iso_(new Date()),
    statusEtapa: CONFIG.STATUS_ETAPA,
    podeEditar: true,
    turmas: turmas,
    etapas: etapas,
    formandos: lerFormandos_(ss),
    regras: lerRegras_(ss),
    responsaveis: lerResponsaveis_(ss),
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
      area: texto_(r[c['area']]),
      curso: texto_(r[c['curso']]),
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
  const fixas = [CONFIG.ABA_CADASTRO, CONFIG.ABA_FORMANDOS, CONFIG.ABA_REGRAS, CONFIG.ABA_LISTAS, CONFIG.ABA_HISTORICO]
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
  const aba = ss.getSheetByName(CONFIG.ABA_FORMANDOS);
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
      curso: curso,
      turma: texto_(v[i][c['turma']]),
      local: texto_(v[i][c['local']]),
      formados: numero_(v[i][c['formados']]) || 0
    });
  }
  return out;
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
    aba.appendRow(['Data/hora', 'Usuário', 'Aba', 'Linha', 'Turma', 'Etapa', 'Status anterior', 'Novo status']);
    aba.setFrozenRows(1);
    aba.getRange(1, 1, 1, 8).setFontWeight('bold');
  }
  aba.appendRow(linha);
}

/* ================================================================== */
/* Cache em blocos (CacheService aceita até 100 KB por chave)          */
/* ================================================================== */

const CACHE_PREFIXO = 'painel_v2_';

function gravarCache_(json) {
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

function lerCache_() {
  const cache = CacheService.getScriptCache();
  const n = Number(cache.get(CACHE_PREFIXO + 'n'));
  if (!n) return null;
  const chaves = [];
  for (let i = 0; i < n; i++) chaves.push(CACHE_PREFIXO + i);
  const partes = cache.getAll(chaves);
  if (Object.keys(partes).length !== n) return null;
  return chaves.map(k => partes[k]).join('');
}

function limparCache() {
  const cache = CacheService.getScriptCache();
  const chaves = [CACHE_PREFIXO + 'n'];
  for (let i = 0; i < 50; i++) chaves.push(CACHE_PREFIXO + i);
  cache.removeAll(chaves);
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
