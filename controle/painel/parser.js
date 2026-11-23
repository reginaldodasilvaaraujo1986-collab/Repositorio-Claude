function parseBalancete(txt){
  var MES={JANEIRO:1,FEVEREIRO:2,MARCO:3,"MARÇO":3,ABRIL:4,MAIO:5,JUNHO:6,JULHO:7,AGOSTO:8,SETEMBRO:9,OUTUBRO:10,NOVEMBRO:11,DEZEMBRO:12};
  var num=function(s){return parseFloat(s.replace(/\./g,"").replace(",","."));};
  var lines=txt.split(/\r?\n/), rows=[], ref=null, ue=null, tipo=null, gerado=null, tot=null;
  var re=/^\s*(\d(?:\.\d{1,2})*)\s+(.*?)\s{2,}([\d.]+,\d{2})(?: ([DC]))?\s+([\d.]+,\d{2})\s+([\d.]+,\d{2})\s+([\d.]+,\d{2})(?: ([DC]))?\s*$/;
  for(var i=0;i<lines.length;i++){
    var L=lines[i], m;
    if(!ref && (m=L.match(/REF\.:\s*([A-ZÇ]+)\s+DE\s+(\d{4})/))) ref={mes:MES[m[1]],ano:+m[2]};
    if(!ue && (m=L.match(/UNIDADE EXECUTORA:\s*([\d ]+?)\s+-/))) ue=m[1].replace(/\s/g,"");
    if(!tipo && (m=L.match(/B A L A N C E T E\s+(.+?)\s{2,}/))) tipo=m[1].replace(/ (?=\S)/g,"").replace(/\s+/g," ").trim();
    if(!gerado && (m=L.match(/DATA:\s*(\d\d\/\d\d\/\d{4})/))) gerado=m[1];
    if((m=L.match(/T O T A I S\s+([\d.]+,\d{2})\s+([\d.]+,\d{2})\s+([\d.]+,\d{2})/))) tot={d:num(m[2]),c:num(m[3])};
    if((m=L.match(re))){
      var a=num(m[3])*(m[4]==="C"?-1:1), s=num(m[7])*(m[8]==="C"?-1:1);
      var desc=m[2].trim();
      var nx=lines[i+1]||""; if(/^\s{20,}\S/.test(nx) && !re.test(nx) && !/PRODEMGE|T O T A I S|_{5}/.test(nx)) desc+=nx.trim();
      rows.push({c:m[1],n:desc,a:+a.toFixed(2),d:num(m[5]),k:num(m[6]),s:+s.toFixed(2)});
    }
  }
  if(!ref||!rows.length) throw new Error("Arquivo não reconhecido como balancete PCASP do SIAFI.");
  return {id:ref.ano+"-"+String(ref.mes).padStart(2,"0"),ano:ref.ano,mes:ref.mes,ue:ue,tipo:tipo,gerado:gerado,totais:tot,contas:rows};
}
if(typeof module!=="undefined") module.exports=parseBalancete;
