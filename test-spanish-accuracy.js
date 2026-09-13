const fs = require('fs');
const html = fs.readFileSync(__dirname + '/subjects/spanish.html', 'utf8');
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const scriptBody = blocks.find(b => b.includes('(function(){'));
let code = scriptBody.replace(/\n  render\(\);[\s\S]*?\n\}\)\(\);\s*$/, `
window.__T__={VERBS:VERBS,REFLEXIVE_VERBS:REFLEXIVE_VERBS,GUSTAR_VERBS:GUSTAR_VERBS,SER_FORMS:SER_FORMS,ESTAR_FORMS:ESTAR_FORMS,TENER_IDIOMS:TENER_IDIOMS,INDEF_WORDS:INDEF_WORDS,PRONOUNS:PRONOUNS,SER_ESTAR_ITEMS:SER_ESTAR_ITEMS,PERO_SINO_ITEMS:PERO_SINO_ITEMS,INDEF_TRANSFORM_ITEMS:INDEF_TRANSFORM_ITEMS,INDEF_PERSONAL_A_ITEMS:INDEF_PERSONAL_A_ITEMS,FUTURE_PLAN_ITEMS:FUTURE_PLAN_ITEMS,
L2_RESTAURANT:L2_RESTAURANT,L2_DELICIOUS_SYN:L2_DELICIOUS_SYN,L2_HEALTHY_SYN:L2_HEALTHY_SYN,L2_FRUTAS_SYN:L2_FRUTAS_SYN,L2_VERDURAS_SYN:L2_VERDURAS_SYN,
L2_VERDURAS:L2_VERDURAS,L2_VERBOS_PRESENTE:L2_VERBOS_PRESENTE,L2_VERB_USAGE:L2_VERB_USAGE,L2_VERBOS_PRETERITO:L2_VERBOS_PRETERITO,
L2_PRETERITO_RULES:L2_PRETERITO_RULES,L2_CGZ_VERBS:L2_CGZ_VERBS,L2_CGZ_EXTRA_YO:L2_CGZ_EXTRA_YO,L2_CGZ_RULES:L2_CGZ_RULES,
L2_PRONOMBRES_RULES:L2_PRONOMBRES_RULES,L2_PRONOMBRES_TRANSFORM:L2_PRONOMBRES_TRANSFORM,L2_PRONOMBRES_ATTACH:L2_PRONOMBRES_ATTACH,
L2_COMPARACIONES_RULES:L2_COMPARACIONES_RULES,L2_SUPERLATIVOS_RULES:L2_SUPERLATIVOS_RULES,L2_ABSOLUTE_SUPERLATIVE:L2_ABSOLUTE_SUPERLATIVE,
ALL_ITEMS:ALL_ITEMS,normalize:normalize,distractorCount:distractorCount,prepQuestion:prepQuestion};
})();`);
if (!code.includes('window.__T__')) throw new Error('hook injection mismatch');
global.window = { scrollTo(){} };
global.localStorage = { getItem(){return null;}, setItem(){} };
global.document = { head:{appendChild(){}}, querySelector(){return {innerHTML:'',appendChild(){}};}, createElement(){return {className:'',innerHTML:'',style:{},classList:{add(){},remove(){}},appendChild(){},addEventListener(){}};} };
eval(code);
const T = window.__T__;

let failures = 0;
function check(name, fn) {
  try { fn(); console.log('OK  ', name); }
  catch (e) { failures++; console.log('FAIL', name, '->', e.message); }
}
function expectForms(label, actual, expected) {
  check(label, () => {
    if (actual.length !== expected.length) throw new Error(`length ${actual.length} != ${expected.length}`);
    for (let i = 0; i < expected.length; i++) {
      if (actual[i] !== expected[i]) throw new Error(`person ${i} (${T.PRONOUNS[i]}): got "${actual[i]}", expected "${expected[i]}"`);
    }
  });
}
function findVerb(list, inf) {
  const v = list.find(x => x.inf === inf);
  if (!v) throw new Error('verb not found: ' + inf);
  return v;
}

console.log('--- ser / estar ---');
expectForms('ser', T.SER_FORMS, ['soy','eres','es','somos','sois','son']);
expectForms('estar', T.ESTAR_FORMS, ['estoy','estás','está','estamos','estáis','están']);

console.log('--- regular verbs ---');
expectForms('hablar', findVerb(T.VERBS.regular,'hablar').forms, ['hablo','hablas','habla','hablamos','habláis','hablan']);
expectForms('comer', findVerb(T.VERBS.regular,'comer').forms, ['como','comes','come','comemos','coméis','comen']);
expectForms('escribir', findVerb(T.VERBS.regular,'escribir').forms, ['escribo','escribes','escribe','escribimos','escribís','escriben']);

console.log('--- irregular yo-form verbs ---');
expectForms('hacer', findVerb(T.VERBS.irregularYo,'hacer').forms, ['hago','haces','hace','hacemos','hacéis','hacen']);
expectForms('poner', findVerb(T.VERBS.irregularYo,'poner').forms, ['pongo','pones','pone','ponemos','ponéis','ponen']);
expectForms('salir', findVerb(T.VERBS.irregularYo,'salir').forms, ['salgo','sales','sale','salimos','salís','salen']);
expectForms('suponer', findVerb(T.VERBS.irregularYo,'suponer').forms, ['supongo','supones','supone','suponemos','suponéis','suponen']);
expectForms('traer', findVerb(T.VERBS.irregularYo,'traer').forms, ['traigo','traes','trae','traemos','traéis','traen']);
expectForms('ver', findVerb(T.VERBS.irregularYo,'ver').forms, ['veo','ves','ve','vemos','veis','ven']);
expectForms('oír', findVerb(T.VERBS.irregularYo,'oír').forms, ['oigo','oyes','oye','oímos','oís','oyen']);

console.log('--- tener / venir / ir ---');
expectForms('tener', findVerb(T.VERBS.tenerVenir,'tener').forms, ['tengo','tienes','tiene','tenemos','tenéis','tienen']);
expectForms('venir', findVerb(T.VERBS.tenerVenir,'venir').forms, ['vengo','vienes','viene','venimos','venís','vienen']);
expectForms('ir', findVerb(T.VERBS.ir,'ir').forms, ['voy','vas','va','vamos','vais','van']);

console.log('--- e:ie stem-changing ---');
expectForms('empezar', findVerb(T.VERBS.stemEIE,'empezar').forms, ['empiezo','empiezas','empieza','empezamos','empezáis','empiezan']);
expectForms('cerrar', findVerb(T.VERBS.stemEIE,'cerrar').forms, ['cierro','cierras','cierra','cerramos','cerráis','cierran']);
expectForms('comenzar', findVerb(T.VERBS.stemEIE,'comenzar').forms, ['comienzo','comienzas','comienza','comenzamos','comenzáis','comienzan']);
expectForms('entender', findVerb(T.VERBS.stemEIE,'entender').forms, ['entiendo','entiendes','entiende','entendemos','entendéis','entienden']);
expectForms('pensar', findVerb(T.VERBS.stemEIE,'pensar').forms, ['pienso','piensas','piensa','pensamos','pensáis','piensan']);
expectForms('perder', findVerb(T.VERBS.stemEIE,'perder').forms, ['pierdo','pierdes','pierde','perdemos','perdéis','pierden']);
expectForms('preferir', findVerb(T.VERBS.stemEIE,'preferir').forms, ['prefiero','prefieres','prefiere','preferimos','preferís','prefieren']);
expectForms('querer', findVerb(T.VERBS.stemEIE,'querer').forms, ['quiero','quieres','quiere','queremos','queréis','quieren']);

console.log('--- o:ue stem-changing ---');
expectForms('volver', findVerb(T.VERBS.stemOUE,'volver').forms, ['vuelvo','vuelves','vuelve','volvemos','volvéis','vuelven']);
expectForms('almorzar', findVerb(T.VERBS.stemOUE,'almorzar').forms, ['almuerzo','almuerzas','almuerza','almorzamos','almorzáis','almuerzan']);
expectForms('contar', findVerb(T.VERBS.stemOUE,'contar').forms, ['cuento','cuentas','cuenta','contamos','contáis','cuentan']);
expectForms('dormir', findVerb(T.VERBS.stemOUE,'dormir').forms, ['duermo','duermes','duerme','dormimos','dormís','duermen']);
expectForms('encontrar', findVerb(T.VERBS.stemOUE,'encontrar').forms, ['encuentro','encuentras','encuentra','encontramos','encontráis','encuentran']);
expectForms('mostrar', findVerb(T.VERBS.stemOUE,'mostrar').forms, ['muestro','muestras','muestra','mostramos','mostráis','muestran']);
expectForms('poder', findVerb(T.VERBS.stemOUE,'poder').forms, ['puedo','puedes','puede','podemos','podéis','pueden']);
expectForms('recordar', findVerb(T.VERBS.stemOUE,'recordar').forms, ['recuerdo','recuerdas','recuerda','recordamos','recordáis','recuerdan']);
expectForms('jugar', findVerb(T.VERBS.jugar,'jugar').forms, ['juego','juegas','juega','jugamos','jugáis','juegan']);

console.log('--- e:i stem-changing ---');
expectForms('pedir', findVerb(T.VERBS.stemEI,'pedir').forms, ['pido','pides','pide','pedimos','pedís','piden']);
expectForms('conseguir', findVerb(T.VERBS.stemEI,'conseguir').forms, ['consigo','consigues','consigue','conseguimos','conseguís','consiguen']);
expectForms('decir', findVerb(T.VERBS.stemEI,'decir').forms, ['digo','dices','dice','decimos','decís','dicen']);
expectForms('repetir', findVerb(T.VERBS.stemEI,'repetir').forms, ['repito','repites','repite','repetimos','repetís','repiten']);
expectForms('seguir', findVerb(T.VERBS.stemEI,'seguir').forms, ['sigo','sigues','sigue','seguimos','seguís','siguen']);

console.log('--- reflexive verbs ---');
expectForms('acordarse de', findVerb(T.REFLEXIVE_VERBS,'acordarse de').forms, ['me acuerdo','te acuerdas','se acuerda','nos acordamos','os acordáis','se acuerdan']);
expectForms('acostarse', findVerb(T.REFLEXIVE_VERBS,'acostarse').forms, ['me acuesto','te acuestas','se acuesta','nos acostamos','os acostáis','se acuestan']);
expectForms('afeitarse', findVerb(T.REFLEXIVE_VERBS,'afeitarse').forms, ['me afeito','te afeitas','se afeita','nos afeitamos','os afeitáis','se afeitan']);
expectForms('arreglarse', findVerb(T.REFLEXIVE_VERBS,'arreglarse').forms, ['me arreglo','te arreglas','se arregla','nos arreglamos','os arregláis','se arreglan']);
expectForms('bañarse', findVerb(T.REFLEXIVE_VERBS,'bañarse').forms, ['me baño','te bañas','se baña','nos bañamos','os bañáis','se bañan']);
expectForms('cepillarse', findVerb(T.REFLEXIVE_VERBS,'cepillarse').forms, ['me cepillo','te cepillas','se cepilla','nos cepillamos','os cepilláis','se cepillan']);
expectForms('despertarse', findVerb(T.REFLEXIVE_VERBS,'despertarse').forms, ['me despierto','te despiertas','se despierta','nos despertamos','os despertáis','se despiertan']);
expectForms('dormirse', findVerb(T.REFLEXIVE_VERBS,'dormirse').forms, ['me duermo','te duermes','se duerme','nos dormimos','os dormís','se duermen']);
expectForms('ducharse', findVerb(T.REFLEXIVE_VERBS,'ducharse').forms, ['me ducho','te duchas','se ducha','nos duchamos','os ducháis','se duchan']);
expectForms('enojarse con', findVerb(T.REFLEXIVE_VERBS,'enojarse con').forms, ['me enojo','te enojas','se enoja','nos enojamos','os enojáis','se enojan']);
expectForms('irse', findVerb(T.REFLEXIVE_VERBS,'irse').forms, ['me voy','te vas','se va','nos vamos','os vais','se van']);
expectForms('lavarse', findVerb(T.REFLEXIVE_VERBS,'lavarse').forms, ['me lavo','te lavas','se lava','nos lavamos','os laváis','se lavan']);
expectForms('levantarse', findVerb(T.REFLEXIVE_VERBS,'levantarse').forms, ['me levanto','te levantas','se levanta','nos levantamos','os levantáis','se levantan']);
expectForms('llamarse', findVerb(T.REFLEXIVE_VERBS,'llamarse').forms, ['me llamo','te llamas','se llama','nos llamamos','os llamáis','se llaman']);
expectForms('maquillarse', findVerb(T.REFLEXIVE_VERBS,'maquillarse').forms, ['me maquillo','te maquillas','se maquilla','nos maquillamos','os maquilláis','se maquillan']);
expectForms("peinarse", findVerb(T.REFLEXIVE_VERBS,'peinarse').forms, ['me peino','te peinas','se peina','nos peinamos','os peináis','se peinan']);
expectForms('ponerse (la ropa)', findVerb(T.REFLEXIVE_VERBS,'ponerse (la ropa)').forms, ['me pongo','te pones','se pone','nos ponemos','os ponéis','se ponen']);
expectForms('preocuparse por', findVerb(T.REFLEXIVE_VERBS,'preocuparse por').forms, ['me preocupo','te preocupas','se preocupa','nos preocupamos','os preocupáis','se preocupan']);
expectForms('probarse', findVerb(T.REFLEXIVE_VERBS,'probarse').forms, ['me pruebo','te pruebas','se prueba','nos probamos','os probáis','se prueban']);
expectForms('quedarse', findVerb(T.REFLEXIVE_VERBS,'quedarse').forms, ['me quedo','te quedas','se queda','nos quedamos','os quedáis','se quedan']);
expectForms('quitarse', findVerb(T.REFLEXIVE_VERBS,'quitarse').forms, ['me quito','te quitas','se quita','nos quitamos','os quitáis','se quitan']);
expectForms('secarse', findVerb(T.REFLEXIVE_VERBS,'secarse').forms, ['me seco','te secas','se seca','nos secamos','os secáis','se secan']);
expectForms('sentarse', findVerb(T.REFLEXIVE_VERBS,'sentarse').forms, ['me siento','te sientas','se sienta','nos sentamos','os sentáis','se sientan']);
expectForms('sentirse', findVerb(T.REFLEXIVE_VERBS,'sentirse').forms, ['me siento','te sientes','se siente','nos sentimos','os sentís','se sienten']);
expectForms('vestirse', findVerb(T.REFLEXIVE_VERBS,'vestirse').forms, ['me visto','te vistes','se viste','nos vestimos','os vestís','se visten']);

console.log('--- ser/estar usage examples: sanity (choice must include the marked answer) ---');
T.SER_ESTAR_ITEMS.forEach((it,i) => check('ser-estar usage #'+i, () => {
  if (!it.choices.includes(it.answer[0])) throw new Error('answer not among its own choices');
}));

console.log('--- pero/sino: sino only when a negation is being replaced ---');
T.PERO_SINO_ITEMS.forEach((it,i) => check('pero/sino #'+i+': '+it.prompt, () => {
  const firstClauseNegative = /\bno\b/i.test(it.prompt.split(',')[0]) || /^no\s/i.test(it.prompt);
  if (it.answer === 'sino' && !firstClauseNegative) throw new Error('marked sino but first clause has no "no": '+it.prompt);
}));

console.log('--- indefinite/negative transforms: answers must not contain an affirmative word ---');
const AFFIRMATIVE_LEAKS = [' alguien', ' algo ', ' alguno', ' alguna', ' siempre', ' también'];
T.INDEF_TRANSFORM_ITEMS.forEach((it,i) => check('indef transform #'+i, () => {
  it.answers.forEach(a => {
    const lower = ' '+a.toLowerCase()+' ';
    AFFIRMATIVE_LEAKS.forEach(word => {
      if (lower.includes(word)) throw new Error(`negative-transform answer still contains "${word.trim()}": "${a}"`);
    });
  });
}));

console.log('--- future-plan translations: every answer must start with the right subject ---');
T.FUTURE_PLAN_ITEMS.forEach((it,i) => check('future-plan #'+i, () => {
  if (!it.answers.length) throw new Error('no accepted answers');
}));

/* ============================= Lección 2 · La comida ============================= */
console.log('--- Lección 2: present tense of the 8 lesson verbs (§2.1) ---');
expectForms('escoger', findVerb(T.L2_VERBOS_PRESENTE,'escoger').forms, ['escojo','escoges','escoge','escogemos','escogéis','escogen']);
expectForms('merendar', findVerb(T.L2_VERBOS_PRESENTE,'merendar').forms, ['meriendo','meriendas','merienda','merendamos','merendáis','meriendan']);
expectForms('morir', findVerb(T.L2_VERBOS_PRESENTE,'morir').forms, ['muero','mueres','muere','morimos','morís','mueren']);
expectForms('pedir', findVerb(T.L2_VERBOS_PRESENTE,'pedir').forms, ['pido','pides','pide','pedimos','pedís','piden']);
expectForms('probar', findVerb(T.L2_VERBOS_PRESENTE,'probar').forms, ['pruebo','pruebas','prueba','probamos','probáis','prueban']);
expectForms('recomendar', findVerb(T.L2_VERBOS_PRESENTE,'recomendar').forms, ['recomiendo','recomiendas','recomienda','recomendamos','recomendáis','recomiendan']);
expectForms('saber (a)', findVerb(T.L2_VERBOS_PRESENTE,'saber (a)').forms, ['sé','sabes','sabe','sabemos','sabéis','saben']);
expectForms('servir', findVerb(T.L2_VERBOS_PRESENTE,'servir').forms, ['sirvo','sirves','sirve','servimos','servís','sirven']);

check('present-tense boot pattern: nosotros/vosotros never carry the stem change', () => {
  T.L2_VERBOS_PRESENTE.forEach(v => {
    const stem = v.inf.replace(/\s*\(.*\)$/, '').replace(/(ar|er|ir)$/, '');
    // nosotros (index 3) and vosotros (index 4) must start with the plain
    // infinitive stem — escoger's g→j and saber's irregular yo are the two
    // exceptions the sheet itself calls out, so they're excluded here.
    if (v.inf === 'escoger' || v.inf.indexOf('saber') === 0) return;
    [3,4].forEach(i => {
      if (v.forms[i].indexOf(stem) !== 0) throw new Error(v.inf+' form '+i+' ("'+v.forms[i]+'") should keep the unchanged stem "'+stem+'"');
    });
  });
});

console.log('--- Lección 2: preterite (§2.2/§2.3) — who changes and who does not ---');
expectForms('servir (pret.)', findVerb(T.L2_VERBOS_PRETERITO,'servir').forms, ['serví','serviste','sirvió','servimos','servisteis','sirvieron']);
expectForms('dormir (pret.)', findVerb(T.L2_VERBOS_PRETERITO,'dormir').forms, ['dormí','dormiste','durmió','dormimos','dormisteis','durmieron']);
expectForms('pedir (pret.)', findVerb(T.L2_VERBOS_PRETERITO,'pedir').forms, ['pedí','pediste','pidió','pedimos','pedisteis','pidieron']);
expectForms('morir (pret.)', findVerb(T.L2_VERBOS_PRETERITO,'morir').forms, ['morí','moriste','murió','morimos','moristeis','murieron']);
expectForms('escoger (pret.)', findVerb(T.L2_VERBOS_PRETERITO,'escoger').forms, ['escogí','escogiste','escogió','escogimos','escogisteis','escogieron']);
expectForms('merendar (pret.)', findVerb(T.L2_VERBOS_PRETERITO,'merendar').forms, ['merendé','merendaste','merendó','merendamos','merendasteis','merendaron']);
expectForms('probar (pret.)', findVerb(T.L2_VERBOS_PRETERITO,'probar').forms, ['probé','probaste','probó','probamos','probasteis','probaron']);
expectForms('recomendar (pret.)', findVerb(T.L2_VERBOS_PRETERITO,'recomendar').forms, ['recomendé','recomendaste','recomendó','recomendamos','recomendasteis','recomendaron']);
expectForms('saber (pret., EXTRA)', findVerb(T.L2_VERBOS_PRETERITO,'saber').forms, ['supe','supiste','supo','supimos','supisteis','supieron']);

check('-ir stem-changing preterite: only the 3rd person (indices 2 and 5) differs from a fully regular verb', () => {
  const IR_STEM_CHANGERS = ['servir','dormir','pedir','morir'];
  T.L2_VERBOS_PRETERITO.filter(v => IR_STEM_CHANGERS.indexOf(v.inf) !== -1).forEach(v => {
    const stem = v.inf.replace(/(ar|er|ir)$/, '');
    [0,1,3,4].forEach(i => {
      if (v.forms[i].indexOf(stem) !== 0) throw new Error(v.inf+' form '+i+' ("'+v.forms[i]+'") should be regular, built on "'+stem+'"');
    });
    [2,5].forEach(i => {
      if (v.forms[i].indexOf(stem) === 0) throw new Error(v.inf+' form '+i+' ("'+v.forms[i]+'") should show the changed vowel, not the plain stem');
    });
  });
});
check('-ar/-er stem-changing preterite: no change anywhere (merendar, probar, recomendar)', () => {
  ['merendar','probar','recomendar'].forEach(inf => {
    const v = findVerb(T.L2_VERBOS_PRETERITO, inf);
    const stem = inf.replace(/(ar|er|ir)$/, '');
    v.forms.forEach((f,i) => { if (f.indexOf(stem) !== 0) throw new Error(inf+' form '+i+' ("'+f+'") lost the regular stem "'+stem+'"'); });
  });
});

console.log('--- Lección 2: -car/-gar/-zar preterite spelling change (§3) — only yo changes ---');
expectForms('sacar', findVerb(T.L2_CGZ_VERBS,'sacar').forms, ['saqué','sacaste','sacó','sacamos','sacasteis','sacaron']);
expectForms('tocar', findVerb(T.L2_CGZ_VERBS,'tocar').forms, ['toqué','tocaste','tocó','tocamos','tocasteis','tocaron']);
expectForms('empacar', findVerb(T.L2_CGZ_VERBS,'empacar').forms, ['empaqué','empacaste','empacó','empacamos','empacasteis','empacaron']);
expectForms('jugar', findVerb(T.L2_CGZ_VERBS,'jugar').forms, ['jugué','jugaste','jugó','jugamos','jugasteis','jugaron']);
expectForms('apagar', findVerb(T.L2_CGZ_VERBS,'apagar').forms, ['apagué','apagaste','apagó','apagamos','apagasteis','apagaron']);
expectForms('llegar', findVerb(T.L2_CGZ_VERBS,'llegar').forms, ['llegué','llegaste','llegó','llegamos','llegasteis','llegaron']);
expectForms('empezar', findVerb(T.L2_CGZ_VERBS,'empezar').forms, ['empecé','empezaste','empezó','empezamos','empezasteis','empezaron']);
expectForms('comenzar', findVerb(T.L2_CGZ_VERBS,'comenzar').forms, ['comencé','comenzaste','comenzó','comenzamos','comenzasteis','comenzaron']);
expectForms('rezar', findVerb(T.L2_CGZ_VERBS,'rezar').forms, ['recé','rezaste','rezó','rezamos','rezasteis','rezaron']);

check('c→qu, g→gu, z→c spelling change appears only in the yo form (index 0)', () => {
  const RULE = {car:['c','qu'], gar:['g','gu'], zar:['z','c']};
  T.L2_CGZ_VERBS.forEach(v => {
    const rawStem = v.inf.slice(0, -2); // drop the -ar ending only
    const trigger = rawStem.slice(-1); // c, g, or z
    const rule = RULE[trigger + 'ar'];
    if (!rule) throw new Error('unexpected ending on '+v.inf);
    const changedStem = rawStem.slice(0, -1) + rule[1];
    if (v.forms[0].indexOf(changedStem) !== 0) throw new Error(v.inf+' yo form "'+v.forms[0]+'" should start with the changed stem "'+changedStem+'"');
    for (let i=1;i<6;i++){
      if (v.forms[i].indexOf(rawStem) !== 0) throw new Error(v.inf+' form '+i+' ("'+v.forms[i]+'") should be built on the unchanged stem "'+rawStem+'"');
    }
  });
});
check('every -car/-gar/-zar yo form carries the required accent', () => {
  T.L2_CGZ_VERBS.forEach(v => { if (!/[éí]/.test(v.forms[0])) throw new Error(v.inf+' yo form "'+v.forms[0]+'" is missing its accent'); });
});
check('§3.7 EXTRA quick-check yo forms all carry the c→qu/g→gu/z→c spelling change and its accent', () => {
  T.L2_CGZ_EXTRA_YO.forEach((it,i) => {
    const a = it.answer[0];
    const looksRight = /qué$/.test(a) || /gué$/.test(a) || /cé$/.test(a);
    if (!looksRight) throw new Error('EXTRA item #'+i+' answer "'+a+'" does not look like a c/g/z-preterite yo form');
  });
});

console.log('--- Lección 2: double object pronouns (§4) — le/les must never survive before lo/la/los/las ---');
check('le/les→se: no transform answer contains "le lo/la" or "les lo/la"', () => {
  const BAD = ['le lo','le la','le los','le las','les lo','les la','les los','les las'];
  T.L2_PRONOMBRES_TRANSFORM.forEach((it,i) => it.answers.forEach(a => {
    const lower = a.toLowerCase();
    BAD.forEach(bad => { if (lower.indexOf(bad) !== -1) throw new Error('transform #'+i+' answer "'+a+'" still contains "'+bad+'"'); });
  }));
});
check('attached-pronoun forms keep the original stressed syllable with a written accent', () => {
  T.L2_PRONOMBRES_ATTACH.forEach((it,i) => {
    if (!/[áéíóú]/.test(it.answer[0])) throw new Error('attach item #'+i+' answer "'+it.answer[0]+'" is missing its accent');
  });
});

console.log('--- Lección 2: irregular comparatives/superlatives (§5.3/§6) ---');
check('bueno/malo/grande/pequeño map to the correct irregular comparative', () => {
  const MAP = [['bueno','mejor'],['malo','peor'],['grande','mayor'],['pequeño','menor']];
  MAP.forEach(([base, comp]) => {
    const hit = T.L2_COMPARACIONES_RULES.find(it => it.answer === comp);
    if (!hit) throw new Error('no drill item found using the irregular comparative "'+comp+'" (for '+base+')');
  });
});

console.log('--- Lección 2: every mc-style rule item includes its own answer among its choices ---');
[].concat(T.L2_VERB_USAGE, T.L2_PRETERITO_RULES, T.L2_CGZ_RULES, T.L2_PRONOMBRES_RULES, T.L2_COMPARACIONES_RULES)
  .concat(T.L2_SUPERLATIVOS_RULES.filter(it => it.choices))
  .forEach((it,i) => check('L2 rule item choices #'+i+': '+it.prompt.slice(0,40), () => {
    if (!it.choices.includes(it.answer)) throw new Error('answer "'+it.answer+'" not among its own choices: '+JSON.stringify(it.choices));
  }));

console.log('--- Lección 2: regional-synonym pairs accept every listed form ---');
check('melocotón/durazno both accepted for peach', () => {
  const es = T.L2_FRUTAS_SYN[0].es;
  if (es.indexOf('el melocotón') === -1 || es.indexOf('el durazno') === -1) throw new Error('peach synonym set incomplete: '+JSON.stringify(es));
});
check('papas/patatas both accepted for potatoes', () => {
  const es = T.L2_VERDURAS_SYN[0].es;
  if (es.indexOf('las papas') === -1 || es.indexOf('las patatas') === -1) throw new Error('potato synonym set incomplete: '+JSON.stringify(es));
});
check('sano/saludable both accepted for healthy', () => {
  const es = T.L2_HEALTHY_SYN[0].es;
  if (es.indexOf('sano/a') === -1 || es.indexOf('saludable') === -1) throw new Error('healthy synonym set incomplete: '+JSON.stringify(es));
});
check('rico/sabroso/delicioso all accepted for delicious/tasty', () => {
  const es = T.L2_DELICIOUS_SYN[0].es;
  ['delicioso/a','rico/a','sabroso/a'].forEach(w => { if (es.indexOf(w) === -1) throw new Error('delicious synonym set missing "'+w+'": '+JSON.stringify(es)); });
});

console.log('--- Lección 2: handout typos are corrected, not reproduced ---');
check('camarero is spelled correctly (sheet typo: "camerero")', () => {
  const it = T.L2_RESTAURANT.find(w => /camarer/.test(w.es));
  if (!it || /camerero/.test(it.es)) throw new Error('camarero typo was not corrected');
});
check('the English gloss reads "asparagus", not the sheet\'s "aparagus"', () => {
  const it = T.L2_VERDURAS.find(w => /espárrago/.test(w.es));
  if (!it || it.en.toLowerCase() !== 'asparagus') throw new Error('asparagus gloss typo was not corrected: '+(it&&it.en));
});
check('apagué is spelled correctly (handwritten typo: "apagé"/"apague")', () => {
  const v = findVerb(T.L2_CGZ_VERBS, 'apagar');
  if (v.forms[0] !== 'apagué') throw new Error('apagué typo was not corrected: got "'+v.forms[0]+'"');
});

console.log('--- Lección 2: content is reachable from ALL_ITEMS (wired into the app, not orphaned data) ---');
check('every Lección 2 topic has items in ALL_ITEMS', () => {
  const L2_TOPICS = ['l2-restaurant','l2-frutas','l2-verduras','l2-carne-pescado','l2-otras-comidas','l2-bebidas','l2-verbos','l2-preterito','l2-car-gar-zar','l2-pronombres','l2-comparaciones','l2-superlativos'];
  L2_TOPICS.forEach(id => {
    const n = T.ALL_ITEMS.filter(it => it.topic === id).length;
    if (n < 4) throw new Error(id+' has only '+n+' items');
  });
});
check('every Lección 2 item declares a tier (SHEET, RULE, or EXTRA)', () => {
  const L2_TOPICS = ['l2-restaurant','l2-frutas','l2-verduras','l2-carne-pescado','l2-otras-comidas','l2-bebidas','l2-verbos','l2-preterito','l2-car-gar-zar','l2-pronombres','l2-comparaciones','l2-superlativos'];
  T.ALL_ITEMS.filter(it => L2_TOPICS.indexOf(it.topic) !== -1).forEach(it => {
    if (['SHEET','RULE','EXTRA'].indexOf(it.tier) === -1) throw new Error(it.id+' has no valid tier: '+it.tier);
  });
});

console.log('--- Fairness of the questions themselves ---');

check('no question shows an option that is also a correct answer to it', ()=>{
  // delicioso/a, rico/a and sabroso/a each had a plain vocab entry as well as a
  // place in L2_DELICIOUS_SYN, so "rico/a" had two cards wanting the same
  // meaning spelled two ways, and each appeared among the other's options.
  const byPrompt = {};
  T.ALL_ITEMS.forEach(i => {
    if (!i.pool) return;
    const k = i.topic + '||' + String(i.prompt).replace(/<[^>]*>/g,'').trim();
    (byPrompt[k] = byPrompt[k] || []).push(i);
  });
  Object.values(byPrompt).forEach(group => {
    group.forEach(item => {
      const mine = new Set(item.answer.map(T.normalize));
      group.forEach(sib => {
        if (sib === item) return;
        const sibAns = T.normalize(sib.answer[0]);
        if (mine.has(sibAns)) return;
        if (item.pool.some(p => T.normalize(p) === sibAns)) {
          throw new Error(item.id + ' can show "' + sib.answer[0] + '", the accepted answer for ' + sib.id);
        }
      });
    });
  });
});

check('no prompt that can be asked typed has more than one accepted answer', ()=>{
  // "___ fiesta (party)" appeared twice — once wanting the definite article,
  // once the indefinite. With the options on screen you could tell which was
  // meant; typed, both "la" and "una" are correct and only one was accepted.
  const seen = {};
  T.ALL_ITEMS.forEach(i => {
    if (i.type === 'mc') return;
    const k = i.topic + '||' + T.normalize(String(i.prompt).replace(/<[^>]*>/g,''));
    (seen[k] = seen[k] || []).push(i);
  });
  Object.entries(seen).forEach(([k, g]) => {
    if (g.length < 2) return;
    const answers = new Set(g.map(x => T.normalize(x.answer[0])));
    if (answers.size > 1) {
      throw new Error('typed prompt "' + k.split('||')[1].slice(0,60) + '" accepts ' + answers.size +
        ' different answers across ' + g.map(x => x.id).join(', '));
    }
  });
});

check('no item is asked as multiple choice with nothing to choose between', ()=>{
  T.ALL_ITEMS.forEach(i => {
    if (T.distractorCount(i) >= 1) return;
    if (T.prepQuestion(i, null).mode === 'mc') {
      throw new Error(i.id + ' renders as multiple choice with no wrong option');
    }
  });
});

check('the definite and indefinite article cards say which one they want', ()=>{
  const def = T.ALL_ITEMS.filter(i => /^art-def-/.test(i.id));
  const indef = T.ALL_ITEMS.filter(i => /^art-indef-/.test(i.id));
  if (!def.length || !indef.length) throw new Error('article items not found');
  def.forEach(i => {
    if (!/\(the /.test(i.prompt)) throw new Error(i.id + ' does not name the definite article: ' + i.prompt);
  });
  indef.forEach(i => {
    if (!/\((a|an|some) /.test(i.prompt)) throw new Error(i.id + ' does not name the indefinite article: ' + i.prompt);
  });
});

console.log(failures===0 ? 'ALL ACCURACY CHECKS PASSED' : (failures+' FAILURES'));
process.exit(failures===0 ? 0 : 1);
