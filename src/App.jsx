import {useState,useEffect,useRef,useCallback} from "react";
import { auth, db } from "./firebase";
import { onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, sendPasswordResetEmail } from "firebase/auth";
import { doc, getDoc, getDocFromCache, setDoc, onSnapshot } from "firebase/firestore";

const flashStyle = `
@keyframes btnPulse {
  0% { transform: scale(1); }
  50% { transform: scale(0.97); }
  100% { transform: scale(1); }
}
.btn-flash { transition: all 0.15s ease-out; }
.btn-flash:active { animation: btnPulse 0.2s ease-out; opacity: 0.9; }
`;

// ── Constantes ────────────────────────────────────────────────────────────────
const CATEGORIAS=["Ternero/a","Novillito","Novillo","Vaquillona","Vaca","Toro","Torito"];
const SEXOS=["Macho","Hembra"];
const RAZAS=["Aberdeen Angus","Hereford","Brahman","Limousin","Charolais","Shorthorn","Brangus","Criolla","Cruza","Otra"];
const ACTIVIDADES_AGRO=["Siembra","Cosecha","Fertilización","Fumigación","Herbicida","Riego","Rastrojo","Laboreo","Encalado","Otro"];
const CULTIVOS=["Soja","Maíz","Trigo","Girasol","Sorgo","Cebada","Avena","Pasturas","Verdeo","Otro"];
const TIPOS_ALERTA=["Vacunación","Desparasitación","Revisión veterinaria","Vencimiento","Mantenimiento","Parto esperado","Otro"];
const MARCAS_COLORES=[
  {k:"rojo",label:"Rojo"},
  {k:"amarillo",label:"Amarillo"},
  {k:"verde",label:"Verde"},
  {k:"azul",label:"Azul"},
];
const MARCAS_MOTIVOS=["Vaca vieja","Descarte","Revisar veterinario","Preñada","Destete","Flaco/a","Cojera","Tratamiento","Separar","Otro"];

// ── Helpers ───────────────────────────────────────────────────────────────────
function hoy(){return new Date().toISOString().split("T")[0];}
function fmtFecha(f){
  if(!f)return "—";
  var d=new Date(f+"T12:00:00");
  return d.toLocaleDateString("es-AR",{day:"2-digit",month:"2-digit",year:"numeric"});
}
function calcEdad(fechaNac){
  if(!fechaNac)return null;
  var hoyD=new Date();
  var nac=new Date(fechaNac+"T12:00:00");
  var dias=Math.floor((hoyD-nac)/86400000);
  if(dias<0)return null;
  if(dias<30)return dias+" días";
  var meses=Math.floor(dias/30.4);
  if(meses<12)return meses+" meses";
  var anios=Math.floor(meses/12);
  var mr=meses%12;
  return anios+" año"+(anios>1?"s":"")+(mr>0?" "+mr+" mes"+(mr>1?"es":""):"");
}
function mesesEdad(fechaNac){
  if(!fechaNac)return null;
  var hoyD=new Date();
  var nac=new Date(fechaNac+"T12:00:00");
  var dias=Math.floor((hoyD-nac)/86400000);
  if(dias<0)return null;
  return Math.floor(dias/30.4);
}
// Sugerir categoría según edad y sexo
function sugerirCategoria(fechaNac,sexo){
  var m=mesesEdad(fechaNac);
  if(m===null)return null;
  if(sexo==="Macho"){
    if(m<10)return "Ternero/a";
    if(m<18)return "Novillito";
    return "Novillo";
  }
  if(sexo==="Hembra"){
    if(m<10)return "Ternero/a";
    if(m<24)return "Vaquillona";
    return "Vaca";
  }
  return null;
}
function colorEmoji(c){
  if(c==="rojo")return "🔴";
  if(c==="amarillo")return "🟡";
  if(c==="verde")return "🟢";
  return "🔵";
}
function marcaColor(c){
  if(c==="rojo")return "bg-red-800 border-red-600 text-red-200";
  if(c==="amarillo")return "bg-amber-700 border-amber-500 text-amber-200";
  if(c==="verde")return "bg-green-800 border-green-600 text-green-200";
  return "bg-blue-800 border-blue-600 text-blue-200";
}
function marcaBgCard(marcas){
  if(!marcas||marcas.length===0)return "bg-white border-gray-200 hover:border-gray-300";
  var c=marcas[0].color;
  if(c==="rojo")return "bg-red-50 border-red-300 hover:border-red-400";
  if(c==="amarillo")return "bg-amber-50 border-amber-300 hover:border-amber-500";
  if(c==="verde")return "bg-green-50 border-green-300 hover:border-green-400";
  return "bg-blue-50 border-blue-300 hover:border-blue-400";
}
function gdpTotal(pesajes){
  if(!pesajes||pesajes.length<2)return null;
  var sorted=[...pesajes].sort(function(a,b){return new Date(a.fecha)-new Date(b.fecha);});
  var first=sorted[0],last=sorted[sorted.length-1];
  var dias=Math.round((new Date(last.fecha)-new Date(first.fecha))/86400000);
  if(dias===0)return null;
  return ((last.peso-first.peso)/dias).toFixed(3);
}
function ultimoPeso(pesajes){
  if(!pesajes||pesajes.length===0)return null;
  return [...pesajes].sort(function(a,b){
    var dif=new Date(b.fecha)-new Date(a.fecha);
    if(dif!==0)return dif;
    // Misma fecha: el de id más alto gana (los id son timestamps)
    return (b.id||0)-(a.id||0);
  })[0].peso;
}
function sumarDias(fecha,dias){
  var d=new Date(fecha+"T12:00:00");
  d.setDate(d.getDate()+dias);
  return d.toISOString().split("T")[0];
}

// Extrae años únicos de una lista de items con fecha (campo configurable)
function aniosDe(items,getFecha){
  var anios={};
  items.forEach(function(it){
    var f=getFecha?getFecha(it):it.fecha;
    if(f){var a=f.substring(0,4);anios[a]=true;}
  });
  return Object.keys(anios).sort(function(a,b){return b.localeCompare(a);});
}

// Componente filtro de año reutilizable
function FiltroAnio({anios,valor,onChange,total,filtrados}){
  if(anios.length===0)return null;
  return(
    <div className="flex items-center gap-2 flex-wrap">
      <label className="text-[10px] text-gray-500 uppercase font-bold">📅 Año:</label>
      <select value={valor} onChange={onChange} className="bg-gray-50 border border-gray-200 rounded-lg px-2 py-1 text-gray-800 text-xs font-bold focus:outline-none">
        <option value="">Todos</option>
        {anios.map(function(a){return <option key={a} value={a}>{a}</option>;})}
      </select>
      {valor&&<span className="text-[10px] text-gray-500">{filtrados+" de "+total}</span>}
    </div>
  );
}
function estadoAlerta(fechaHora,pasada){
  if(pasada)return "pasada";
  var diff=new Date(fechaHora)-new Date();
  if(diff<0)return "pasada";
  if(diff<86400000*3)return "urgente";
  if(diff<86400000*7)return "pronto";
  return "ok";
}

// ── Storage ───────────────────────────────────────────────────────────────────
function leerStorage(clave,def){
  try{var x=localStorage.getItem(clave);return x?JSON.parse(x):def;}catch(e){return def;}
}
function guardarStorage(clave,val){
  try{localStorage.setItem(clave,JSON.stringify(val));}catch(e){}
}

// ── Sync con Firestore ────────────────────────────────────────────────────────
// Estrategia: un solo documento por usuario con todos sus datos.
// Path: users/{uid}/data/main
// - Al abrir: bajamos desde Firestore (si hay) o subimos desde localStorage (primera vez)
// - Al cambiar: subimos a Firestore con debounce de 2 segundos

var _syncTimeout=null;
var _syncUid=null;
var _syncEnabled=false;

function refDatosUsuario(uid){
  return doc(db,"usuarios",uid,"datos","principal");
}

// Sube los datos locales a Firestore (con debounce para no saturar)
function sincronizarArriba(uid,datos){
  if(!uid||!_syncEnabled)return;
  if(_syncTimeout)clearTimeout(_syncTimeout);
  _syncTimeout=setTimeout(function(){
    setDoc(refDatosUsuario(uid),{
      establecimientos:datos.establecimientos||[],
      actualizado:new Date().toISOString()
    }).catch(function(err){
      console.error("Error sincronizando:",err);
    });
  },2000); // Espera 2 segundos desde el último cambio
}

// Activa el sync para un usuario
function activarSync(uid){
  _syncUid=uid;
  _syncEnabled=true;
}
function desactivarSync(){
  _syncEnabled=false;
  _syncUid=null;
  if(_syncTimeout){clearTimeout(_syncTimeout);_syncTimeout=null;}
}

// ── Log de Cambios ────────────────────────────────────────────────────────────
function logCambio(tipo,texto,detalle){
  try{
    var logs=leerStorage("ganadera_cambios_v1",[]);
    logs.unshift({id:Date.now()+Math.random(),tipo,texto,detalle:detalle||"",fecha:new Date().toISOString()});
    // Límite de 500 entradas para no saturar
    if(logs.length>500)logs=logs.slice(0,500);
    guardarStorage("ganadera_cambios_v1",logs);
  }catch(e){}
}

// ── Export ────────────────────────────────────────────────────────────────────
function exportDatosRodeo(animales,nombre){
  var headers=["Caravana","Sexo","Categoría","Raza","F.Nacimiento","Edad","Último peso","GDP total","Obs"];
  var rows=animales.map(function(a){
    var up=ultimoPeso(a.pesajes);
    var g=gdpTotal(a.pesajes);
    return [
      a.caravana,a.sexo,a.categoria,a.raza||"",
      a.fechaNac?fmtFecha(a.fechaNac):"",
      a.fechaNac?calcEdad(a.fechaNac)||"":"",
      up?up+"kg":"",
      g!==null?g+" kg/d":"",
      a.obs||""
    ];
  });
  return {titulo:"Rodeo: "+nombre,headers,rows};
}
function exportDatosSesion(sesion,nombreLote){
  var headers=["Caravana","Sexo","Categoría","Peso kg","GDP kg/d","Kg ganados","Días"];
  var rows=sesion.registros.map(function(r){
    return [r.caravana,r.sexo||"",r.categoria||"",r.peso,
      r.gdpAnimal!==null&&r.gdpAnimal!==undefined?r.gdpAnimal:"",
      r.kgGanados!==undefined?r.kgGanados:"",
      r.diasTranscurridos!==undefined?r.diasTranscurridos:""];
  });
  return {titulo:"Sesión "+nombreLote+" - "+fmtFecha(sesion.fecha),headers,rows};
}

function exportDatosRepro(sesion,nombreLote){
  var tipoLbl=sesion.tipo==="tacto"?"Tacto":sesion.tipo==="servicio"?"Servicio":"Partos";
  var headers,rows;
  if(sesion.tipo==="tacto"){
    headers=["Caravana","Categoría","Resultado","Fecha parto probable","Observaciones"];
    rows=sesion.registros.map(function(r){
      return [r.caravana,r.categoria||"",r.resultado||"",
        r.fechaPartoProbable?fmtFecha(r.fechaPartoProbable):"",r.obs||""];
    });
  }else if(sesion.tipo==="servicio"){
    headers=["Caravana","Categoría","Tipo","Toro","Fecha servicio","Observaciones"];
    rows=sesion.registros.map(function(r){
      return [r.caravana,r.categoria||"",r.tipo||"",
        r.toro&&r.toro!=="__otro"?r.toro:"",
        r.fechaServicio?fmtFecha(r.fechaServicio):"",r.obs||""];
    });
  }else{
    headers=["Caravana","Categoría","Estado","Sexo ternero","Caravana ternero","Observaciones"];
    rows=sesion.registros.map(function(r){
      return [r.caravana,r.categoria||"",r.vivo?"Vivo":"Muerto",
        r.sexoTernero||"",r.caravanaTernero||"",r.obs||""];
    });
  }
  return {titulo:tipoLbl+" "+nombreLote+" - "+fmtFecha(sesion.fecha),headers,rows};
}

// ── UI base ───────────────────────────────────────────────────────────────────
function Badge({text,color}){
  var cls="text-xs px-2 py-0.5 rounded-full font-semibold border ";
  if(color==="macho")cls+="bg-blue-900 text-blue-300 border-blue-700";
  else if(color==="hembra")cls+="bg-pink-900 text-pink-300 border-pink-700";
  else cls+="bg-gray-100 text-gray-700 border-gray-200";
  return <span className={cls}>{text}</span>;
}
function Inp({label,className,value,onChange,type,placeholder,inputRef}){
  return(
    <div className={"flex flex-col gap-1 "+(className||"")}>
      {label&&<label className="text-[10px] text-green-600 font-bold uppercase tracking-wider">{label}</label>}
      <input ref={inputRef} type={type||"text"} value={value} onChange={onChange} placeholder={placeholder||""}
        style={{background:"#f9fafb"}} className=" border border-gray-200 rounded-xl px-3 py-2.5 text-gray-900 text-sm focus:outline-none focus:border-emerald-400 placeholder-gray-400"/>
    </div>
  );
}
function Sel({label,options,value,onChange}){
  return(
    <div className="flex flex-col gap-1">
      {label&&<label className="text-[10px] text-green-600 font-bold uppercase tracking-wider">{label}</label>}
      <select value={value} onChange={onChange} className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-gray-800 text-sm focus:outline-none focus:border-green-400">
        <option value="">— Elegir —</option>
        {options.map(function(o){return <option key={o} value={o}>{o}</option>;})}
      </select>
    </div>
  );
}

// Selector de fecha con 3 dropdowns (Día / Mes / Año) - útil para fechas viejas
function FechaSelector({label,value,onChange,minAnio}){
  // Estado interno para los valores parciales mientras el usuario los elige
  var [parts,setParts]=useState(function(){
    var p=value?value.split("-"):["","",""];
    return {anio:p[0]||"",mes:p[1]||"",dia:p[2]||""};
  });

  // Sincronizar si value cambia desde afuera
  useEffect(function(){
    var p=value?value.split("-"):["","",""];
    setParts({anio:p[0]||"",mes:p[1]||"",dia:p[2]||""});
  },[value]);

  var anioActual=new Date().getFullYear();
  var anioMin=minAnio||(anioActual-30);
  var anios=[];
  for(var y=anioActual;y>=anioMin;y--)anios.push(String(y));

  var meses=[
    {n:"01",l:"Enero"},{n:"02",l:"Febrero"},{n:"03",l:"Marzo"},{n:"04",l:"Abril"},
    {n:"05",l:"Mayo"},{n:"06",l:"Junio"},{n:"07",l:"Julio"},{n:"08",l:"Agosto"},
    {n:"09",l:"Septiembre"},{n:"10",l:"Octubre"},{n:"11",l:"Noviembre"},{n:"12",l:"Diciembre"}
  ];

  // Días según mes y año seleccionados
  var diasEnMes=31;
  if(parts.mes&&parts.anio){
    var m=parseInt(parts.mes),a=parseInt(parts.anio);
    if([4,6,9,11].indexOf(m)>=0)diasEnMes=30;
    else if(m===2)diasEnMes=(a%4===0&&a%100!==0)||a%400===0?29:28;
  }
  var dias=[];
  for(var d=1;d<=diasEnMes;d++)dias.push(d<10?"0"+d:String(d));

  function actualizar(nuevasParts){
    setParts(nuevasParts);
    // Solo emitir el onChange cuando los 3 valores estén completos
    if(nuevasParts.anio&&nuevasParts.mes&&nuevasParts.dia){
      // Ajustar día si es mayor al máximo del mes
      var maxDias=31;
      var mNum=parseInt(nuevasParts.mes),aNum=parseInt(nuevasParts.anio);
      if([4,6,9,11].indexOf(mNum)>=0)maxDias=30;
      else if(mNum===2)maxDias=(aNum%4===0&&aNum%100!==0)||aNum%400===0?29:28;
      var diaFinal=parseInt(nuevasParts.dia)>maxDias?(maxDias<10?"0"+maxDias:String(maxDias)):nuevasParts.dia;
      onChange(nuevasParts.anio+"-"+nuevasParts.mes+"-"+diaFinal);
    }else if(!nuevasParts.anio&&!nuevasParts.mes&&!nuevasParts.dia){
      onChange("");
    }
  }

  return(
    <div className="flex flex-col gap-1">
      {label&&<label className="text-[10px] text-green-600 font-bold uppercase tracking-wider">{label}</label>}
      <div className="grid grid-cols-3 gap-1.5">
        <select value={parts.dia} onChange={function(e){actualizar(Object.assign({},parts,{dia:e.target.value}));}} className="bg-gray-50 border border-gray-200 rounded-xl px-2 py-2.5 text-gray-800 text-sm focus:outline-none focus:border-green-400">
          <option value="">Día</option>
          {dias.map(function(d){return <option key={d} value={d}>{parseInt(d)}</option>;})}
        </select>
        <select value={parts.mes} onChange={function(e){actualizar(Object.assign({},parts,{mes:e.target.value}));}} className="bg-gray-50 border border-gray-200 rounded-xl px-2 py-2.5 text-gray-800 text-sm focus:outline-none focus:border-green-400">
          <option value="">Mes</option>
          {meses.map(function(m){return <option key={m.n} value={m.n}>{m.l}</option>;})}
        </select>
        <select value={parts.anio} onChange={function(e){actualizar(Object.assign({},parts,{anio:e.target.value}));}} className="bg-gray-50 border border-gray-200 rounded-xl px-2 py-2.5 text-gray-800 text-sm focus:outline-none focus:border-green-400">
          <option value="">Año</option>
          {anios.map(function(a){return <option key={a} value={a}>{a}</option>;})}
        </select>
      </div>
      {(parts.dia||parts.mes||parts.anio)&&!(parts.dia&&parts.mes&&parts.anio)&&(
        <p className="text-[10px] text-amber-600">⚠️ Completá los 3 campos para guardar</p>
      )}
    </div>
  );
}
function Modal({title,onClose,children}){
  return(
    <div className="fixed inset-0 z-50 flex items-end justify-center" style={{background:"rgba(0,0,0,0.5)"}}>
      <div className="w-full max-w-xl rounded-t-3xl flex flex-col shadow-2xl" style={{height:"95vh",background:"#ffffff"}}>
        <div className="flex items-center justify-between px-5 pt-4 pb-3 shrink-0 border-b border-gray-100">
          <h2 className="text-lg font-black text-gray-800">{title}</h2>
          <button onClick={onClose} className="bg-gray-100 hover:bg-gray-200 active:scale-95 text-gray-600 font-bold text-sm px-4 py-2 rounded-xl transition-all">✕</button>
        </div>
        <div className="overflow-y-auto px-5 pb-6" style={{flex:"1 1 0",minHeight:0}}>
          <div className="py-3">{children}</div>
        </div>
      </div>
    </div>
  );
}
function useConfirm(){
  var [state,setState]=useState(null);
  function ask(msg,onOk){setState({msg,onOk});}
  var dialog=state?(
    <div className="fixed inset-0 z-[60] flex items-center justify-center" style={{background:"rgba(0,0,0,0.7)"}}>
      <div className="mx-4 rounded-2xl p-6 flex flex-col gap-4 max-w-sm w-full" style={{background:"#74acdf"}}>
        <p className="text-gray-800 font-bold text-base text-center">{state.msg}</p>
        <div className="flex gap-3">
          <button onClick={function(){setState(null);}} className="flex-1 py-2.5 rounded-xl bg-gray-100 text-gray-700 font-bold border border-gray-200">Cancelar</button>
          <button onClick={function(){state.onOk();setState(null);}} className="flex-1 py-2.5 rounded-xl bg-red-600 text-white font-bold border border-red-800">Eliminar</button>
        </div>
      </div>
    </div>
  ):null;
  return [ask,dialog];
}

// ── Export Modal ──────────────────────────────────────────────────────────────
function ExportModal({titulo,headers,rows,onClose}){
  var [copiado,setCopiado]=useState(false);
  function copiar(){
    var txt=[headers.join("\t"),...rows.map(function(r){return r.join("\t");})].join("\n");
    if(navigator.clipboard){
      navigator.clipboard.writeText(txt).then(function(){setCopiado(true);setTimeout(function(){setCopiado(false);},2000);});
    }
  }
  var txt=[headers.join("\t"),...rows.map(function(r){return r.join("\t");})].join("\n");
  return(
    <Modal title={"📊 "+titulo} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-gray-400">Copiá y pegá en Excel o Google Sheets</p>
        <textarea readOnly value={txt} rows={6} className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-gray-900 text-xs font-mono focus:outline-none resize-none"/>
        <button onClick={copiar} style={{boxShadow:"0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.08)"}} className={"w-full font-bold py-3 rounded-xl text-base border-2 "+(copiado?"bg-green-600 border-green-400 text-white":"bg-emerald-600 border-emerald-400 text-white")}>
          {copiado?"✓ Copiado!":"📋 Copiar"}
        </button>
      </div>
    </Modal>
  );
}

// ── Nuevo Lote Modal ──────────────────────────────────────────────────────────
function NuevoLoteModal({loteEditar,onClose,onSave}){
  var [nombre,setNombre]=useState(loteEditar?loteEditar.nombre:"");
  var [tipo,setTipo]=useState(loteEditar?loteEditar.tipo:"ganaderia");
  var ref=useRef();
  useEffect(function(){if(ref.current)ref.current.focus();},[]);
  function save(){if(!nombre.trim())return;onSave(nombre.trim(),tipo);onClose();}
  return(
    <Modal title={loteEditar?"✏️ Renombrar lote":"➕ Nuevo lote"} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <Inp label="Nombre del lote" value={nombre} onChange={function(e){setNombre(e.target.value);}} inputRef={ref}
          placeholder="Ej: Campo Norte, Rodeo 1..."/>
        {!loteEditar&&(
          <div className="flex flex-col gap-2">
            <label className="text-[10px] text-green-600 font-bold uppercase">Tipo de lote</label>
            <div className="grid grid-cols-3 gap-2">
              {[["ganaderia","🐄","Ganadería"],["agricultura","🌾","Agricultura"],["mixto","🔄","Mixto"]].map(function(item){
                return(
                  <button key={item[0]} onClick={function(){setTipo(item[0]);}}
                    className={"flex flex-col items-center py-3 rounded-xl border-2 text-xs font-bold transition-all "+(tipo===item[0]?"bg-emerald-100 border-emerald-400 text-gray-900":"bg-gray-50 border-gray-200 text-gray-400")}>
                    <span className="text-2xl mb-1">{item[1]}</span>{item[2]}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <button onClick={save} style={{boxShadow:"0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.08)"}} className="w-full bg-emerald-600 text-white font-black py-3 rounded-xl border border-emerald-500">
          {loteEditar?"Guardar":"Crear Lote"}
        </button>
      </div>
    </Modal>
  );
}

// ── Nuevo Animal Modal ────────────────────────────────────────────────────────
function NuevoAnimalModal({onClose,onSave,caravanaInicial}){
  var [f,setF]=useState({caravana:caravanaInicial||"",sexo:"",categoria:"",raza:"",fechaNac:"",obs:"",peso:"",fecha:hoy()});
  var ref=useRef();
  useEffect(function(){if(!caravanaInicial&&ref.current)ref.current.focus();},[]);
  function set(k,v){setF(function(prev){return Object.assign({},prev,{[k]:v});});}
  function guardar(){
    if(!f.caravana.trim()||!f.sexo||!f.categoria)return;
    var animal={id:Date.now(),caravana:f.caravana.trim().toUpperCase(),sexo:f.sexo,categoria:f.categoria,
      raza:f.raza,fechaNac:f.fechaNac,obs:f.obs,marcas:[],
      pesajes:f.peso?[{id:Date.now()+1,peso:parseFloat(f.peso),fecha:f.fecha}]:[]};
    onSave(animal);onClose();
  }
  return(
    <Modal title="➕ Nuevo Animal" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <Inp label="Caravana *" value={f.caravana} onChange={function(e){set("caravana",e.target.value);}} inputRef={ref} placeholder="Ej: 1234A"/>
        <div className="grid grid-cols-2 gap-3">
          <Sel label="Sexo *" options={SEXOS} value={f.sexo} onChange={function(e){set("sexo",e.target.value);}}/>
          <Sel label="Categoría *" options={CATEGORIAS} value={f.categoria} onChange={function(e){set("categoria",e.target.value);}}/>
        </div>
        <Sel label="Raza" options={RAZAS} value={f.raza} onChange={function(e){set("raza",e.target.value);}}/>
        <FechaSelector label="Fecha de nac. (opcional)" value={f.fechaNac} onChange={function(v){set("fechaNac",v);}} minAnio={new Date().getFullYear()-25}/>
        <div className="grid grid-cols-2 gap-3">
          <Inp label="Peso inicial (kg)" type="number" value={f.peso} onChange={function(e){set("peso",e.target.value);}} placeholder="0"/>
          <Inp label="Fecha peso" type="date" value={f.fecha} onChange={function(e){set("fecha",e.target.value);}}/>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-green-600 font-bold uppercase">Observaciones</label>
          <textarea rows={2} value={f.obs} onChange={function(e){set("obs",e.target.value);}} placeholder="Notas sobre el animal..."
            className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-gray-800 text-sm focus:outline-none focus:border-green-400 resize-none"/>
        </div>
        <button onClick={guardar} style={{boxShadow:"0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.08)"}} className="w-full bg-emerald-600 text-white font-black py-3 rounded-xl border border-emerald-500">
          Guardar Animal
        </button>
      </div>
    </Modal>
  );
}

// ── Marca Form ────────────────────────────────────────────────────────────────
function MarcaForm({onAdd}){
  var [show,setShow]=useState(false);
  var [color,setColor]=useState("rojo");
  var [motivo,setMotivo]=useState("");
  var [custom,setCustom]=useState("");
  if(!show)return(
    <button onClick={function(){setShow(true);}} className="text-xs text-gray-700 border border-gray-200 py-2 px-3 rounded-xl">+ Agregar marca</button>
  );
  return(
    <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 flex flex-col gap-2">
      <div className="flex gap-1">
        {MARCAS_COLORES.map(function(c){
          var active=color===c.k;
          var cls="flex-1 py-1.5 rounded-lg text-sm font-bold border "+(active?marcaColor(c.k)+" border":"bg-gray-50 border-gray-200 text-gray-400");
          return <button key={c.k} onClick={function(){setColor(c.k);}} className={cls}>{colorEmoji(c.k)}</button>;
        })}
      </div>
      <select value={motivo} onChange={function(e){setMotivo(e.target.value);}} style={{background:"#f9fafb"}} className=" border border-gray-200 rounded-xl px-3 py-2 text-gray-900 text-sm focus:outline-none">
        <option value="">— Motivo —</option>
        {MARCAS_MOTIVOS.map(function(m){return <option key={m} value={m}>{m}</option>;})}
        <option value="__otro">✏️ Otro</option>
      </select>
      {motivo==="__otro"&&<input value={custom} onChange={function(e){setCustom(e.target.value);}} onKeyDown={function(e){if(e.key==="Enter"&&custom.trim()){onAdd({id:Date.now(),color,motivo:custom.trim()});setShow(false);setMotivo("");setCustom("");setColor("rojo");}}} placeholder="Escribí el motivo..." autoFocus style={{background:"#f9fafb"}} className=" border border-gray-200 rounded-xl px-3 py-2 text-gray-900 text-sm focus:outline-none"/>}
      <div className="flex gap-2">
        <button onClick={function(){setShow(false);}} className="flex-1 py-1.5 rounded-xl border border-gray-200 text-gray-500 text-xs">Cancelar</button>
        <button onClick={function(){
          var m=motivo==="__otro"?custom.trim():motivo;
          if(!m)return;
          onAdd({id:Date.now(),color,motivo:m});
          setShow(false);setMotivo("");setCustom("");setColor("rojo");
        }} className="flex-1 py-1.5 rounded-xl bg-emerald-600 text-gray-900 font-bold text-xs border border-emerald-400">Guardar</button>
      </div>
    </div>
  );
}

// ── Detalle Animal Modal ──────────────────────────────────────────────────────
function DetalleModal({animal,onClose,onUpdate,onDelete,lotes,loteActualId,establecimientos,estId,onMoverEst,onVender,nombreLote,reproSesionesLote}){
  var [tab,setTab]=useState("info");
  var [obs,setObs]=useState(animal.obs||"");
  var [peso,setPeso]=useState("");
  var [fecha,setFecha]=useState(hoy());
  var [showMover,setShowMover]=useState(false);
  var [loteDestino,setLoteDestino]=useState("");
  var [showMoverEst,setShowMoverEst]=useState(false);
  var [estDestino,setEstDestino]=useState("");
  var [loteEnEst,setLoteEnEst]=useState("");
  var [showVender,setShowVender]=useState(false);
  var [showEditar,setShowEditar]=useState(false);
  var [formSan,setFormSan]=useState({tipo:"Vacuna",nombre:"",fecha:hoy(),proxima:"",obs:""});
  var [ask,confirmDialog]=useConfirm();
  var pesoRef=useRef();
  var sanidad=animal.sanidad||[];
  var sorted=[...(animal.pesajes||[])].sort(function(a,b){return new Date(b.fecha)-new Date(a.fecha);});
  var up=ultimoPeso(animal.pesajes);
  var g=gdpTotal(animal.pesajes);
  var otrosLotes=lotes.filter(function(l){return l.id!==loteActualId;});
  var estDestinoObj=establecimientos&&estDestino?(establecimientos.find(function(e){return e.id===parseInt(estDestino);})||null):null;

  function addPeso(){
    if(!peso)return;
    onUpdate(Object.assign({},animal,{pesajes:[...(animal.pesajes||[]),{id:Date.now(),peso:parseFloat(peso),fecha}]}));
    setPeso("");
    if(pesoRef.current)pesoRef.current.focus();
  }

  var infoData=[
    ["Sexo",animal.sexo],["Categoría",animal.categoria],["Raza",animal.raza||"—"],
    ["F. Nacimiento",animal.fechaNac?fmtFecha(animal.fechaNac):"—"],
    ["Edad",animal.fechaNac?calcEdad(animal.fechaNac)||"—":"—"],
    ["Último peso",up?up+" kg":"—"],
    ["GDP total",g!==null?g+" kg/d":"—"]
  ];

  return(
    <Modal title={"Caravana "+animal.caravana} onClose={onClose}>
      <div className="flex gap-1 mb-3 bg-gray-100 rounded-xl p-1">
        {(animal.sexo==="Hembra"?["info","pesajes","repro","sanidad"]:["info","pesajes","sanidad"]).map(function(t){
          return(
            <button key={t} onClick={function(){setTab(t);}}
              className={"flex-1 py-2 rounded-xl text-[10px] font-bold tracking-wider transition-all "+(tab===t?"bg-white text-gray-900 shadow-sm":"text-gray-500")}>
              {t==="info"?"📋 Info":t==="pesajes"?"⚖️ Pesos":t==="repro"?"🐄 Repro":"💉 Sanidad"}
            </button>
          );
        })}
      </div>

      {tab==="info"&&(
        <div className="flex flex-col gap-2">
          {/* Sugerencia cambio categoría por edad */}
          {(function(){
            var sug=sugerirCategoria(animal.fechaNac,animal.sexo);
            if(!sug||sug===animal.categoria)return null;
            return(
              <div className="bg-sky-50 border border-sky-200 rounded-xl px-3 py-2 flex items-center justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sky-800 font-bold text-sm">💡 Cambió de categoría</p>
                  <p className="text-sky-700 text-xs">Por su edad ya es <span className="font-bold">{sug}</span> (estaba como {animal.categoria})</p>
                </div>
                <button onClick={function(){onUpdate(Object.assign({},animal,{categoria:sug}));}} className="bg-sky-500 text-white font-bold px-3 py-2 rounded-xl text-xs shrink-0">Actualizar</button>
              </div>
            );
          })()}

          {/* Stats compactos en 2 filas */}
          <div className="grid grid-cols-3 gap-1.5">
            {[["Sexo",animal.sexo],["Categoría",animal.categoria],["Raza",animal.raza||"—"],
              ["F. Nac.",animal.fechaNac?fmtFecha(animal.fechaNac):"—"],
              ["Edad",animal.fechaNac?calcEdad(animal.fechaNac)||"—":"—"],
              ["Último kg",up?up+" kg":"—"]
            ].map(function(item){
              return(
                <div key={item[0]} className="bg-gray-50 border border-gray-200 rounded-xl px-2 py-2 text-center">
                  <p className="text-[9px] text-green-600 uppercase font-bold mb-0.5">{item[0]}</p>
                  <p className="text-gray-800 font-bold text-xs leading-tight">{item[1]}</p>
                </div>
              );
            })}
          </div>

          <button onClick={function(){setShowEditar(true);}} className="w-full text-sm text-sky-700 border border-sky-300 bg-sky-50 px-3 py-2 rounded-xl font-bold">✏️ Editar datos del animal</button>

          {/* GDP si existe */}
          {g!==null&&(
            <div className={"rounded-xl px-3 py-2 text-center border "+(parseFloat(g)>=0?"bg-green-900/30 border-green-700":"bg-red-900/30 border-red-700")}>
              <p className="text-[9px] uppercase font-bold text-gray-700 mb-0.5">GDP total</p>
              <p className={"font-black text-base "+(parseFloat(g)>=0?"text-green-300":"text-red-300")}>{g+" kg/d"}</p>
            </div>
          )}

          {/* Obs */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-emerald-700 font-bold uppercase">Observaciones</label>
            <div className="flex gap-2">
              <textarea rows={2} value={obs} onChange={function(e){setObs(e.target.value);}}
                className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-gray-800 text-sm focus:outline-none focus:border-green-400 resize-none"/>
              <button onClick={function(){onUpdate(Object.assign({},animal,{obs}));}} className="self-end text-xs bg-green-100 text-green-700 border border-green-300 px-3 py-2 rounded-lg font-bold">💾</button>
            </div>
          </div>

          {/* Marcas */}
          <div className="flex flex-col gap-1.5">
            <p className="text-[10px] text-green-600 font-bold uppercase">🏷️ Marcas</p>
            <div className="flex flex-wrap gap-1">
              {(animal.marcas||[]).map(function(m){
                return(
                  <div key={m.id} className={"flex items-center gap-1 px-2 py-1 rounded-full border text-xs font-bold "+marcaColor(m.color)}>
                    <span>{colorEmoji(m.color)+" "+m.motivo}</span>
                    <button onClick={function(){onUpdate(Object.assign({},animal,{marcas:(animal.marcas||[]).filter(function(x){return x.id!==m.id;})}));}} className="opacity-60 hover:opacity-100 ml-1">✕</button>
                  </div>
                );
              })}
            </div>
            <MarcaForm onAdd={function(m){onUpdate(Object.assign({},animal,{marcas:[...(animal.marcas||[]),m]}));}}/>
          </div>

          {/* Acciones */}
          <div className="flex flex-col gap-1.5 border-t border-gray-100 pt-2">
            {otrosLotes.length>0&&!showMover&&(
              <button onClick={function(){setShowMover(true);}} className="w-full text-sm text-blue-600 border border-blue-200 bg-blue-50 py-2 rounded-xl font-medium">🔀 Mover a otro lote</button>
            )}
            {showMover&&(
              <div className="flex flex-col gap-1.5">
                <select value={loteDestino} onChange={function(e){setLoteDestino(e.target.value);}} style={{background:"#ecfdf5"}} className=" border border-emerald-400 rounded-xl px-3 py-2 text-gray-900 text-sm focus:outline-none">
                  <option value="">— Elegir lote —</option>
                  {otrosLotes.map(function(l){return <option key={l.id} value={l.id}>{l.nombre}</option>;})}
                </select>
                <div className="flex gap-2">
                  <button onClick={function(){setShowMover(false);}} className="flex-1 text-sm text-gray-500 border border-gray-200 py-2 rounded-xl">Cancelar</button>
                  <button onClick={function(){if(!loteDestino)return;onUpdate(Object.assign({},animal,{_moverA:loteDestino}));onClose();}} className="flex-1 bg-blue-500 text-white font-bold py-2 rounded-xl text-sm">Confirmar</button>
                </div>
              </div>
            )}
            {establecimientos&&establecimientos.length>1&&!showMoverEst&&(
              <button onClick={function(){setShowMoverEst(true);}} className="w-full text-sm text-orange-600 border border-orange-200 bg-orange-50 py-2 rounded-xl font-medium">🏡 Mover a otro establecimiento</button>
            )}
            {showMoverEst&&(
              <div className="flex flex-col gap-1.5">
                <select value={estDestino} onChange={function(e){setEstDestino(e.target.value);setLoteEnEst("");}} className="bg-amber-50 border border-orange-300 rounded-xl px-3 py-2 text-orange-700 text-sm focus:outline-none">
                  <option value="">— Establecimiento —</option>
                  {establecimientos.filter(function(e){return e.id!==estId;}).map(function(e){return <option key={e.id} value={e.id}>{e.nombre}</option>;})}
                </select>
                {estDestinoObj&&(
                  <select value={loteEnEst} onChange={function(e){setLoteEnEst(e.target.value);}} className="bg-amber-50 border border-orange-300 rounded-xl px-3 py-2 text-orange-700 text-sm focus:outline-none">
                    <option value="">— Lote destino —</option>
                    {(estDestinoObj.lotes||[]).map(function(l){return <option key={l.id} value={l.id}>{l.nombre}</option>;})}
                  </select>
                )}
                <div className="flex gap-2">
                  <button onClick={function(){setShowMoverEst(false);}} className="flex-1 text-sm text-gray-500 border border-gray-200 py-2 rounded-xl">Cancelar</button>
                  <button onClick={function(){if(!estDestino||!loteEnEst)return;onMoverEst&&onMoverEst(parseInt(estDestino),parseInt(loteEnEst));onClose();}} className="flex-1 bg-orange-500 text-white font-bold py-2 rounded-xl text-sm">Confirmar</button>
                </div>
              </div>
            )}
            <button onClick={function(){setShowVender(true);}} className="self-start text-xs text-emerald-700 border border-emerald-400 bg-emerald-50 px-3 py-1.5 rounded-lg font-bold">💰 Vender animal</button>
            <button onClick={function(){ask("¿Eliminar este animal?",function(){onDelete(animal.id);onClose();});}} className="self-start text-xs text-red-400 border border-red-700 px-3 py-1.5 rounded-lg">🗑 Eliminar</button>
          </div>
        </div>
      )}

      {showVender&&<VenderAnimalModal animal={animal} loteNombre={nombreLote||""} onClose={function(){setShowVender(false);}} onVender={function(datosVenta){onVender&&onVender(animal,datosVenta);setShowVender(false);onClose();}}/>}
      {showEditar&&<EditarAnimalModal animal={animal} onClose={function(){setShowEditar(false);}} onGuardar={function(datos){onUpdate(Object.assign({},animal,datos));setShowEditar(false);}}/>}

      {tab==="pesajes"&&(
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <input ref={pesoRef} type="number" inputMode="decimal" value={peso} onChange={function(e){setPeso(e.target.value);}}
              onKeyDown={function(e){if(e.key==="Enter")addPeso();}}
              placeholder="kg" className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-gray-800 text-sm focus:outline-none focus:border-green-400"/>
            <input type="date" value={fecha} onChange={function(e){setFecha(e.target.value);}} className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-gray-800 text-sm focus:outline-none focus:border-green-400"/>
          </div>
          <button onClick={addPeso} style={{boxShadow:"0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.08)"}} className="w-full bg-emerald-600 text-white font-black py-2.5 rounded-xl border border-emerald-500">+ Agregar pesaje</button>
          <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto">
            {sorted.map(function(p){
              return(
                <div key={p.id} className="flex items-center justify-between bg-gray-50 border border-gray-100 rounded-xl px-4 py-2">
                  <div>
                    <p className="text-gray-800 font-bold">{p.peso+" kg"}</p>
                    <p className="text-green-600 text-xs">{fmtFecha(p.fecha)}</p>
                  </div>
                  <button onClick={function(){onUpdate(Object.assign({},animal,{pesajes:(animal.pesajes||[]).filter(function(x){return x.id!==p.id;})}));}} className="text-red-500 text-lg">✕</button>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {tab==="repro"&&animal.sexo==="Hembra"&&(function(){
        // Buscar todas las apariciones del animal en sesiones reproductivas
        var sesiones=reproSesionesLote||[];
        var serviciosA=[];
        var tactosA=[];
        var partosA=[];
        sesiones.forEach(function(s){
          (s.registros||[]).forEach(function(r){
            if(r.caravana!==animal.caravana)return;
            var item=Object.assign({},r,{fechaSesion:s.fecha,tipoSesion:s.tipo});
            if(s.tipo==="servicio")serviciosA.push(item);
            else if(s.tipo==="tacto")tactosA.push(item);
            else if(s.tipo==="parto")partosA.push(item);
          });
        });
        // Ordenar por fecha desc (más reciente primero)
        serviciosA.sort(function(a,b){return (b.fechaServicio||b.fechaSesion).localeCompare(a.fechaServicio||a.fechaSesion);});
        tactosA.sort(function(a,b){return b.fechaSesion.localeCompare(a.fechaSesion);});
        partosA.sort(function(a,b){return b.fechaSesion.localeCompare(a.fechaSesion);});
        var totalEventos=serviciosA.length+tactosA.length+partosA.length;
        // Resumen general
        var totalPartos=partosA.length;
        var partosVivos=partosA.filter(function(p){return p.vivo;}).length;
        var totalTactos=tactosA.length;
        var tactosPos=tactosA.filter(function(t){return t.resultado==="Preñada";}).length;
        // Última actividad
        var todos=[].concat(
          serviciosA.map(function(s){return {fecha:s.fechaServicio||s.fechaSesion,tipo:"Servicio"};}),
          tactosA.map(function(t){return {fecha:t.fechaSesion,tipo:"Tacto: "+(t.resultado||"")};}),
          partosA.map(function(p){return {fecha:p.fechaSesion,tipo:"Parto"+(p.vivo?" (vivo)":" (muerto)")};})
        );
        todos.sort(function(a,b){return b.fecha.localeCompare(a.fecha);});
        var ultima=todos[0];

        if(totalEventos===0){
          return(
            <div className="flex flex-col gap-3">
              <div className="text-center py-12 text-gray-400">
                <p className="text-5xl mb-3">🐄</p>
                <p className="text-sm font-bold">Sin actividad reproductiva</p>
                <p className="text-xs mt-2 text-gray-500">Cuando agregues servicios, tactos o partos en este lote, aparecerán acá</p>
              </div>
            </div>
          );
        }

        // Agrupar todos los eventos por año
        var porAnio={};
        serviciosA.forEach(function(s){var a=(s.fechaServicio||s.fechaSesion).substring(0,4);if(!porAnio[a])porAnio[a]={servicios:[],tactos:[],partos:[]};porAnio[a].servicios.push(s);});
        tactosA.forEach(function(t){var a=t.fechaSesion.substring(0,4);if(!porAnio[a])porAnio[a]={servicios:[],tactos:[],partos:[]};porAnio[a].tactos.push(t);});
        partosA.forEach(function(p){var a=p.fechaSesion.substring(0,4);if(!porAnio[a])porAnio[a]={servicios:[],tactos:[],partos:[]};porAnio[a].partos.push(p);});
        var aniosOrd=Object.keys(porAnio).sort(function(a,b){return b.localeCompare(a);});

        return(
          <div className="flex flex-col gap-3">
            {/* Resumen general */}
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-center">
                <p className="text-[10px] text-emerald-600 uppercase font-bold mb-0.5">Terneros nacidos</p>
                <p className="text-2xl font-black text-emerald-700">{totalPartos}</p>
                {totalPartos>0&&<p className="text-[10px] text-emerald-500">{partosVivos+" vivos"}</p>}
              </div>
              <div className="bg-pink-50 border border-pink-200 rounded-xl p-3 text-center">
                <p className="text-[10px] text-pink-600 uppercase font-bold mb-0.5">% Preñez</p>
                <p className="text-2xl font-black text-pink-700">{totalTactos>0?Math.round(tactosPos/totalTactos*100)+"%":"—"}</p>
                {totalTactos>0&&<p className="text-[10px] text-pink-500">{tactosPos+" de "+totalTactos+" tactos"}</p>}
              </div>
            </div>

            {ultima&&(
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-2.5 text-center">
                <p className="text-[10px] text-gray-500 uppercase font-bold">Última actividad</p>
                <p className="text-sm font-bold text-gray-800">{ultima.tipo+" · "+fmtFecha(ultima.fecha)}</p>
              </div>
            )}

            {/* Por año */}
            {aniosOrd.map(function(a){
              var grupo=porAnio[a];
              return(
                <div key={a} className="border border-pink-200 rounded-xl p-3 flex flex-col gap-2 bg-pink-50/30">
                  <p className="text-pink-700 font-black text-sm">📅 {a}</p>

                  {grupo.servicios.length>0&&(
                    <div className="flex flex-col gap-1">
                      <p className="text-[10px] text-pink-600 uppercase font-bold">💉 Servicios ({grupo.servicios.length})</p>
                      {grupo.servicios.map(function(s,i){
                        return(
                          <div key={"s"+i} className="bg-white border border-pink-100 rounded-lg px-2 py-1.5 text-xs">
                            <p className="text-gray-800"><span className="font-bold">{fmtFecha(s.fechaServicio||s.fechaSesion)}</span>{" · "+(s.tipo||"")}{s.toro&&s.toro!=="__otro"?" · "+s.toro:""}</p>
                            {s.obs&&<p className="text-gray-500 text-[10px]">{s.obs}</p>}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {grupo.tactos.length>0&&(
                    <div className="flex flex-col gap-1">
                      <p className="text-[10px] text-pink-600 uppercase font-bold">🔍 Tactos ({grupo.tactos.length})</p>
                      {grupo.tactos.map(function(t,i){
                        return(
                          <div key={"t"+i} className="bg-white border border-pink-100 rounded-lg px-2 py-1.5 text-xs">
                            <p className="text-gray-800"><span className="font-bold">{fmtFecha(t.fechaSesion)}</span>{" · "}<span className={t.resultado==="Preñada"?"text-emerald-700 font-bold":t.resultado==="Vacía"?"text-red-600 font-bold":"text-amber-700 font-bold"}>{t.resultado||""}</span></p>
                            {t.fechaPartoProbable&&<p className="text-amber-700 text-[10px]">Parto est.: {fmtFecha(t.fechaPartoProbable)}</p>}
                            {t.obs&&<p className="text-gray-500 text-[10px]">{t.obs}</p>}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {grupo.partos.length>0&&(
                    <div className="flex flex-col gap-1">
                      <p className="text-[10px] text-pink-600 uppercase font-bold">🐄 Partos ({grupo.partos.length})</p>
                      {grupo.partos.map(function(p,i){
                        return(
                          <div key={"p"+i} className="bg-white border border-pink-100 rounded-lg px-2 py-1.5 text-xs">
                            <p className="text-gray-800"><span className="font-bold">{fmtFecha(p.fechaSesion)}</span>{" · "}<span className={p.vivo?"text-emerald-700 font-bold":"text-red-600 font-bold"}>{p.vivo?"Vivo":"Muerto"}</span>{p.sexoTernero?" · "+(p.sexoTernero==="Macho"?"♂":"♀")+" "+p.sexoTernero:""}</p>
                            {p.caravanaTernero&&<p className="text-gray-600 text-[10px]">Ternero: {p.caravanaTernero}</p>}
                            {p.obs&&<p className="text-gray-500 text-[10px]">{p.obs}</p>}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })()}
      {tab==="sanidad"&&(
        <div className="flex flex-col gap-3">
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 flex flex-col gap-2">
            <p className="text-xs font-black text-gray-500 uppercase">+ Nuevo registro</p>
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] text-gray-500 font-bold uppercase">Tipo</label>
                <select value={formSan.tipo} onChange={function(e){setFormSan(Object.assign({},formSan,{tipo:e.target.value}));}} className="bg-white border border-gray-200 rounded-xl px-2 py-2 text-gray-900 text-sm focus:outline-none">
                  <option>Vacuna</option>
                  <option>Desparasitación</option>
                  <option>Tratamiento</option>
                  <option>Revisión</option>
                  <option>Otro</option>
                </select>
              </div>
              <Inp label="Nombre/Descripción" placeholder="Ej: Aftosa, Ivermectina..." value={formSan.nombre} onChange={function(e){setFormSan(Object.assign({},formSan,{nombre:e.target.value}));}}/>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Inp label="Fecha" type="date" value={formSan.fecha} onChange={function(e){setFormSan(Object.assign({},formSan,{fecha:e.target.value}));}}/>
              <Inp label="Próxima dosis" type="date" value={formSan.proxima} onChange={function(e){setFormSan(Object.assign({},formSan,{proxima:e.target.value}));}}/>
            </div>
            <Inp label="Observaciones" placeholder="Opcional" value={formSan.obs} onChange={function(e){setFormSan(Object.assign({},formSan,{obs:e.target.value}));}}/>
            <button onClick={function(){
              if(!formSan.nombre.trim())return;
              var reg=Object.assign({id:Date.now()},formSan);
              onUpdate(Object.assign({},animal,{sanidad:[...sanidad,reg]}));
              setFormSan({tipo:"Vacuna",nombre:"",fecha:hoy(),proxima:"",obs:""});
            }} className="w-full bg-emerald-500 text-white font-bold py-2.5 rounded-xl text-sm border border-emerald-500">Guardar</button>
          </div>

          {sanidad.length===0&&<div className="text-center py-6 text-gray-400"><p className="text-3xl mb-1">💉</p><p className="text-xs">Sin registros sanitarios</p></div>}
          <div className="flex flex-col gap-1.5 max-h-64 overflow-y-auto">
            {[...sanidad].sort(function(a,b){return b.fecha.localeCompare(a.fecha);}).map(function(r){
              var vence=null;
              if(r.proxima){
                var dif=Math.floor((new Date(r.proxima+"T12:00:00")-new Date())/86400000);
                if(dif<0)vence={label:"Vencida hace "+Math.abs(dif)+"d",cls:"bg-red-50 text-red-700 border-red-200"};
                else if(dif<=7)vence={label:"Vence en "+dif+"d",cls:"bg-amber-50 text-amber-700 border-amber-200"};
                else vence={label:"Vence "+fmtFecha(r.proxima),cls:"bg-gray-50 text-gray-600 border-gray-200"};
              }
              var iconTipo=r.tipo==="Vacuna"?"💉":r.tipo==="Desparasitación"?"🪱":r.tipo==="Tratamiento"?"💊":r.tipo==="Revisión"?"🔍":"📋";
              return(
                <div key={r.id} className="bg-white border border-gray-200 rounded-xl px-3 py-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-gray-900 font-bold text-sm">{iconTipo} {r.nombre}</p>
                      <p className="text-gray-500 text-xs">{r.tipo+" · "+fmtFecha(r.fecha)}</p>
                      {r.obs&&<p className="text-gray-600 text-xs mt-0.5">{r.obs}</p>}
                      {vence&&<span className={"inline-block mt-1 text-[10px] px-2 py-0.5 rounded-full border font-bold "+vence.cls}>{vence.label}</span>}
                    </div>
                    <button onClick={function(){ask("¿Eliminar este registro?",function(){onUpdate(Object.assign({},animal,{sanidad:sanidad.filter(function(x){return x.id!==r.id;})}));});}} className="text-red-500 text-lg shrink-0">✕</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {confirmDialog}
    </Modal>
  )
}

// ── Sesión de Pesaje ──────────────────────────────────────────────────────────
function SesionPesaje({loteId,allLotes,setLotes,nombreLote,sesionInicial,onPausar,onFinalizar}){
  var [log,setLog]=useState(sesionInicial?sesionInicial.registros:[]);
  var [fecha]=useState(sesionInicial?sesionInicial.fecha:hoy());
  var [nota,setNota]=useState(sesionInicial&&sesionInicial.nota?sesionInicial.nota:"");
  var [showNota,setShowNota]=useState(false);
  var [busq,setBusq]=useState("");
  var [encontrado,setEncontrado]=useState(null);
  var [peso,setPeso]=useState("");
  var [flash,setFlash]=useState(false);
  var [showFaltantes,setShowFaltantes]=useState(false);
  var [editandoId,setEditandoId]=useState(null);
  var [pesoEdit,setPesoEdit]=useState("");
  var busqRef=useRef();
  var pesoRef=useRef();
  useEffect(function(){if(busqRef.current)busqRef.current.focus();},[]);

  var animalesActuales=(allLotes.find(function(l){return l.id===loteId;})||{animales:[]}).animales||[];

  function buscar(val){
    var q=val.trim().toUpperCase();
    if(!q){setEncontrado(null);return;}
    var match=animalesActuales.find(function(a){return a.caravana===q;});
    if(match){setEncontrado(match);setTimeout(function(){if(pesoRef.current)pesoRef.current.focus();},80);}
    else setEncontrado(null);
  }

  var yaRegistrado=encontrado&&log.some(function(r){return r.caravana===encontrado.caravana;});
  var noEncontrado=busq.trim().length>0&&!encontrado;

  function registrar(){
    if(!encontrado||!peso)return;
    if(yaRegistrado)return;
    // NO guardamos en setLotes aquí - eso lo hace finalizarSesion para evitar duplicados.
    // El pesaje queda solo en el "log" de la sesión hasta que se haga FIN.
    var ga=encontrado.pesajes&&encontrado.pesajes.length>=1?gdpTotal([...(encontrado.pesajes||[]),{peso:parseFloat(peso),fecha:fecha}]):null;
    var upAnterior=ultimoPeso(encontrado.pesajes);
    var diasTrans=encontrado.pesajes&&encontrado.pesajes.length>0?
      Math.round((new Date(fecha)-new Date([...encontrado.pesajes].sort(function(a,b){return new Date(b.fecha)-new Date(a.fecha);})[0].fecha))/86400000):null;
    var kgGan=upAnterior!==null?parseFloat((parseFloat(peso)-upAnterior).toFixed(1)):null;
    setLog(function(prev){return [{caravana:encontrado.caravana,peso:parseFloat(peso),sexo:encontrado.sexo,categoria:encontrado.categoria,
      gdpAnimal:ga!==null?parseFloat(ga):null,kgGanados:kgGan,diasTranscurridos:diasTrans,marcas:encontrado.marcas||[],id:Date.now()},...prev];});
    setFlash(true);setTimeout(function(){setFlash(false);},600);
    setBusq("");setPeso("");setEncontrado(null);
    if(busqRef.current)setTimeout(function(){busqRef.current.focus();},80);
  }

  // Stats barra
  var totalKg=log.reduce(function(s,r){return s+r.peso;},0);
  var kgGanTotal=log.filter(function(r){return r.kgGanados!==null;}).reduce(function(s,r){return s+r.kgGanados;},0);
  var maxPeso=log.length>0?log.reduce(function(m,r){return r.peso>m.peso?r:m;},log[0]):null;
  var minPeso=log.length>0?log.reduce(function(m,r){return r.peso<m.peso?r:m;},log[0]):null;

  // Animales del lote que aún no fueron pesados en esta sesión
  var faltantes=animalesActuales.filter(function(a){
    return !log.some(function(r){return r.caravana===a.caravana;});
  });

  function iniciarEdicion(r){
    setEditandoId(r.id);
    setPesoEdit(String(r.peso));
  }

  function guardarEdicion(r){
    var nuevoPeso=parseFloat(pesoEdit);
    if(isNaN(nuevoPeso)||nuevoPeso<=0){setEditandoId(null);return;}
    // Solo actualizar log - el animal se actualiza recién al hacer FIN
    setLog(function(prev){return prev.map(function(x){
      if(x.id!==r.id)return x;
      var anim=animalesActuales.find(function(a){return a.caravana===r.caravana;});
      var upAnt=anim&&anim.pesajes&&anim.pesajes.length>0?
        [...anim.pesajes].sort(function(a,b){return new Date(b.fecha)-new Date(a.fecha);})[0].peso:null;
      var kgGan=upAnt!==null?parseFloat((nuevoPeso-upAnt).toFixed(1)):null;
      return Object.assign({},x,{peso:nuevoPeso,kgGanados:kgGan});
    });});
    setEditandoId(null);
    setPesoEdit("");
  }

  function eliminarDelLog(r){
    // Solo sacar del log - el animal nunca tuvo el pesaje (se agrega al FIN)
    setLog(function(prev){return prev.filter(function(x){return x.id!==r.id;});});
  }

  return(
    <div className="fixed inset-0 z-40 flex flex-col" style={{background:"#ffffff"}}>

      {/* Header */}
      <div className="px-4 py-2 shrink-0 bg-white border-b border-gray-200">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">{"Manga · "+nombreLote}</p>
            <h2 className="text-lg font-bold text-gray-900">{"Sesión "+fmtFecha(fecha)}</h2>
          </div>
          <div className="flex gap-2">
            <button onClick={function(){setShowNota(function(v){return !v;});}} className={"border font-bold px-3 py-1.5 rounded-xl text-xs "+(nota?"bg-sky-50 border-sky-300 text-sky-700":"bg-white border-gray-200 text-gray-600")} title="Agregar nota">📝{nota?" •":""}</button>
            <button onClick={function(){onPausar({fecha,registros:[...log].reverse(),nota});}} className="bg-white border border-gray-200 text-gray-700 font-bold px-3 py-1.5 rounded-xl text-xs">⏸ Pausar</button>
            <button onClick={function(){onFinalizar({fecha,registros:[...log].reverse(),nota});}} style={{boxShadow:"0 1px 2px rgba(0,0,0,0.1)"}} className="btn-flash bg-red-500 text-white font-black px-4 py-1.5 rounded-xl text-sm border border-red-500">FIN</button>
          </div>
        </div>
        {showNota&&(
          <div className="mt-2 pb-1">
            <textarea value={nota} onChange={function(e){setNota(e.target.value);}} rows={2} placeholder="Ej: lluvia, balanza descalibrada +2kg, se escapó uno..."
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-gray-900 text-sm focus:outline-none focus:border-gray-900 resize-none placeholder-gray-400"/>
          </div>
        )}
      </div>
      {/* Stats bar */}
      <div className="px-4 py-2 shrink-0 flex gap-4 overflow-x-auto bg-gray-50 border-b border-gray-200">
        <div className="flex items-center gap-1.5 shrink-0"><span className="text-[10px] text-gray-500 uppercase">Pesados:</span><span className="text-gray-900 font-bold text-sm">{log.length}</span></div>
        {faltantes.length>0&&(
          <button onClick={function(){setShowFaltantes(true);}} className="flex items-center gap-1.5 shrink-0 bg-amber-100 border border-amber-300 px-2 py-0.5 rounded-lg">
            <span className="text-[10px] text-amber-700 uppercase font-bold">Falta:</span>
            <span className="text-amber-800 font-bold text-sm">{faltantes.length}</span>
            <span className="text-amber-700 text-xs underline">Ver</span>
          </button>
        )}
        {log.length>0&&<div className="flex items-center gap-1.5 shrink-0"><span className="text-[10px] text-gray-500 uppercase">Total kg:</span><span className="text-gray-900 font-bold text-sm">{totalKg.toLocaleString("es-AR")}</span></div>}
        {kgGanTotal!==0&&<div className="flex items-center gap-1.5 shrink-0"><span className="text-[10px] text-gray-500 uppercase">Ganados:</span><span className={"font-bold text-sm "+(kgGanTotal>=0?"text-emerald-600":"text-red-500")}>{(kgGanTotal>0?"+":"")+kgGanTotal.toFixed(1)+" kg"}</span></div>}
        {maxPeso&&<div className="flex items-center gap-1.5 shrink-0"><span className="text-[10px] text-gray-500 uppercase">Max:</span><span className="text-gray-900 font-bold text-sm">{maxPeso.caravana+" "+maxPeso.peso+"kg"}</span></div>}
      </div>
      {/* Main */}
      <div className="flex-1 overflow-y-auto flex flex-col">
        <div className="px-4 pt-4 pb-3">
          <label className="text-[10px] text-gray-500 font-bold uppercase tracking-wider block mb-2">📡 Caravana</label>
          <input ref={busqRef} value={busq}
            onChange={function(e){setBusq(e.target.value);buscar(e.target.value);}}
            onKeyDown={function(e){if(e.key==="Enter"){if(encontrado&&!yaRegistrado&&peso)registrar();else buscar(busq);}}}
            placeholder="N° caravana..." autoComplete="off" autoCorrect="off" autoCapitalize="characters" spellCheck="false"
            className={"w-full border-2 rounded-2xl px-4 py-4 text-2xl font-bold tracking-widest focus:outline-none transition-colors "+(flash?"bg-green-900 border-green-500 text-green-200":"bg-gray-50 border-gray-200 focus:border-emerald-400 text-gray-900 placeholder-gray-400")}/>

          {/* Animal encontrado */}
          {encontrado&&(
            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-3 mt-3 flex flex-col gap-2">
              {/* Marcas alert */}
              {(encontrado.marcas||[]).length>0&&(
                <div className="flex flex-col gap-1">
                  {(encontrado.marcas||[]).map(function(m){
                    return <div key={m.id} className={"px-3 py-1.5 rounded-xl border font-bold text-sm "+marcaColor(m.color)}>{colorEmoji(m.color)+" "+m.motivo}</div>;
                  })}
                </div>
              )}
              <div className="flex items-center gap-3">
                <div style={{background:"#1a3a10"}} className=" rounded-xl w-10 h-10 flex items-center justify-center text-green-400 text-xl font-black border border-emerald-200">✓</div>
                <div className="flex-1">
                  <p className="text-gray-900 font-bold">{encontrado.caravana}</p>
                  <p className="text-gray-500 text-xs">{encontrado.categoria+" · "+encontrado.sexo}</p>
                  {yaRegistrado&&<p className="text-amber-300 text-xs font-bold">⚠️ Ya registrado</p>}
                  {!yaRegistrado&&(function(){
                    var up=ultimoPeso(encontrado.pesajes);
                    if(up!==null){
                      var ultSorted=[...(encontrado.pesajes||[])].sort(function(a,b){return new Date(b.fecha)-new Date(a.fecha);});
                      var dias=Math.round((new Date(fecha)-new Date(ultSorted[0].fecha))/86400000);
                      return <p className="text-emerald-700 text-xs font-bold">📊 Último: {up+" kg"}{dias>0?" · hace "+dias+"d":""}</p>;
                    }
                    return <p className="text-sky-600 text-xs font-bold">🆕 Primer pesaje</p>;
                  })()}
                </div>
              </div>
              {!yaRegistrado&&(
                <div className="flex flex-col gap-2">
                  <input ref={pesoRef} type="number" inputMode="decimal" value={peso}
                    onChange={function(e){setPeso(e.target.value);}}
                    onKeyDown={function(e){if(e.key==="Enter")registrar();}}
                    placeholder="kg" className="w-full bg-gray-50 border border-emerald-200 rounded-xl px-4 py-3 text-gray-900 text-xl font-bold focus:outline-none focus:border-emerald-400 text-center"/>
                  <button onClick={registrar} style={{boxShadow:"0 1px 3px rgba(0,0,0,0.12)"}} className="w-full bg-emerald-600 text-gray-900 rounded-xl py-4 text-2xl font-black border border-emerald-600">ENTER</button>
                </div>
              )}
            </div>
          )}
          {noEncontrado&&<p className="mt-2 text-amber-400 text-sm font-bold">{"⚠️ "+busq.trim().toUpperCase()+" — no encontrado"}</p>}
        </div>
        {/* Log */}
        <div className="px-4 pb-4">
          <p className="text-[10px] text-gray-400 uppercase tracking-wider font-bold mb-2">{log.length+" pesajes"+(log.length>0?" · Tocá uno para editar":"")}</p>
          {log.map(function(r,i){
            var editando=editandoId===r.id;
            return(
              <div key={r.id} className={"rounded-xl px-3 py-2.5 mb-1.5 border "+(i===0&&!editando?"bg-emerald-50 border-emerald-200":editando?"bg-sky-50 border-sky-300":"bg-gray-50 border-gray-200")}>
                {editando?(
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-gray-900 font-bold">{r.caravana}</p>
                        <p className="text-gray-500 text-xs">{r.categoria}</p>
                      </div>
                      <button onClick={function(){setEditandoId(null);setPesoEdit("");}} className="text-gray-500 text-sm">✕</button>
                    </div>
                    <div className="flex gap-2">
                      <input type="number" inputMode="decimal" value={pesoEdit} onChange={function(e){setPesoEdit(e.target.value);}}
                        onKeyDown={function(e){if(e.key==="Enter")guardarEdicion(r);}}
                        autoFocus
                        className="flex-1 bg-white border border-gray-300 rounded-xl px-3 py-2 text-gray-900 text-lg font-bold focus:outline-none focus:border-gray-900 text-center"/>
                      <button onClick={function(){guardarEdicion(r);}} className="bg-emerald-500 text-white font-bold px-4 py-2 rounded-xl text-sm">✓</button>
                      <button onClick={function(){eliminarDelLog(r);setEditandoId(null);}} className="bg-red-50 border border-red-200 text-red-600 font-bold px-3 py-2 rounded-xl text-sm">🗑</button>
                    </div>
                  </div>
                ):(
                  <button onClick={function(){iniciarEdicion(r);}} className="w-full text-left flex items-center justify-between">
                    <div>
                      <p className="text-gray-900 font-bold">{r.caravana}</p>
                      <p className="text-gray-500 text-xs">{r.categoria}</p>
                      {(r.marcas||[]).length>0&&<p className="text-xs">{r.marcas.map(function(m){return colorEmoji(m.color);}).join(" ")}</p>}
                    </div>
                    <div className="text-right">
                      <p className="text-gray-900 font-bold">{r.peso+" kg"}</p>
                      {r.kgGanados!==null&&r.kgGanados!==undefined&&<p className={"text-xs font-semibold "+(r.kgGanados>=0?"text-emerald-600":"text-red-500")}>{(r.kgGanados>0?"+":"")+r.kgGanados+" kg"}</p>}
                    </div>
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {showFaltantes&&(
        <Modal title={"⚠️ Faltan pesar ("+faltantes.length+")"} onClose={function(){setShowFaltantes(false);}}>
          <div className="flex flex-col gap-2">
            {faltantes.length===0?(
              <p className="text-center text-emerald-600 font-bold py-8">✅ Todos pesados!</p>
            ):(
              <>
                <p className="text-xs text-gray-500 mb-1">{"Del lote "+nombreLote+" · "+animalesActuales.length+" animales totales"}</p>
                {[...faltantes].sort(function(a,b){return a.caravana.localeCompare(b.caravana);}).map(function(a){
                  return(
                    <div key={a.id} className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                      <div className="flex items-center gap-2">
                        <div className="bg-white rounded-xl w-9 h-9 flex items-center justify-center font-black text-amber-700 border border-amber-200 text-xs">{a.caravana.slice(-2)}</div>
                        <div>
                          <p className="text-gray-900 font-bold text-sm">{a.caravana}</p>
                          <p className="text-gray-500 text-xs">{a.sexo+" · "+a.categoria}</p>
                        </div>
                      </div>
                      {(a.marcas||[]).length>0&&<span className="text-sm">{a.marcas.map(function(m){return colorEmoji(m.color);}).join(" ")}</span>}
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Resumen Sesión Modal ──────────────────────────────────────────────────────
function ResumenSesionModal({sesion,nombreLote,animales,onVerAnimal,onClose}){
  var [exportData,setExportData]=useState(null);
  var [verFaltantes,setVerFaltantes]=useState(false);
  var regs=sesion.registros||[];
  var totalKg=regs.reduce(function(s,r){return s+r.peso;},0);
  var promKg=regs.length>0?(totalKg/regs.length).toFixed(1):0;
  var maxR=regs.length>0?regs.reduce(function(m,r){return r.peso>m.peso?r:m;},regs[0]):null;
  var minR=regs.length>0?regs.reduce(function(m,r){return r.peso<m.peso?r:m;},regs[0]):null;
  var gdpVals=regs.filter(function(r){return r.gdpAnimal!==null&&r.gdpAnimal!==undefined;});
  var gdpProm=gdpVals.length>0?(gdpVals.reduce(function(s,r){return s+r.gdpAnimal;},0)/gdpVals.length).toFixed(3):null;
  var kgGanVals=regs.filter(function(r){return r.kgGanados!==null&&r.kgGanados!==undefined;});
  var kgGanTotal=kgGanVals.reduce(function(s,r){return s+r.kgGanados;},0);

  // Faltantes: animales del lote que NO están en los registros de esta sesión
  var faltantes=(animales||[]).filter(function(a){
    return !regs.some(function(r){return r.caravana===a.caravana;});
  });

  var stats=[
    ["🐄 Animales",regs.length],
    ["⚖️ Total kg",totalKg.toLocaleString("es-AR")],
    ["📊 Prom kg",promKg],
    ["📈 GDP prom",gdpProm?gdpProm+" kg/d":"—"],
    ["▲ Más pesado",maxR?maxR.caravana+" "+maxR.peso+"kg":"—"],
    ["▼ Más liviano",minR?minR.caravana+" "+minR.peso+"kg":"—"],
  ];
  if(kgGanVals.length>0)stats.push(["💪 Kg ganados",kgGanTotal.toFixed(1)+" kg"]);
  var diasVals=regs.filter(function(r){return r.diasTranscurridos!==null&&r.diasTranscurridos!==undefined;});
  var diasProm=diasVals.length>0?Math.round(diasVals.reduce(function(s,r){return s+r.diasTranscurridos;},0)/diasVals.length):null;
  if(diasProm!==null)stats.push(["📅 Días desde últ. pesaje",diasProm+" días"]);

  return(
    <Modal title={"📋 Sesión "+fmtFecha(sesion.fecha)} onClose={onClose}>
      <div className="flex flex-col gap-3">
        {sesion.nota&&(
          <div className="bg-sky-50 border border-sky-200 rounded-xl px-3 py-2">
            <p className="text-[10px] text-sky-700 uppercase font-bold">📝 Nota de la sesión</p>
            <p className="text-gray-800 text-sm mt-0.5 whitespace-pre-wrap">{sesion.nota}</p>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          {stats.map(function(s){
            return(
              <div key={s[0]} style={{background:"#ffffff"}} className=" border border-gray-200 rounded-xl p-3 text-center">
                <p className="text-[10px] text-gray-500 uppercase font-bold mb-1">{s[0]}</p>
                <p className="text-gray-900 font-black text-sm">{s[1]}</p>
              </div>
            );
          })}
        </div>

        {/* Banner faltantes */}
        {animales&&animales.length>0&&(
          faltantes.length>0?(
            <button onClick={function(){setVerFaltantes(function(v){return !v;});}} className="w-full bg-amber-50 border border-amber-300 rounded-xl px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xl">⚠️</span>
                <div className="text-left">
                  <p className="text-amber-800 font-bold text-sm">{"Faltaron "+faltantes.length+" animal"+(faltantes.length>1?"es":"")+" por pesar"}</p>
                  <p className="text-amber-600 text-xs">{"de "+animales.length+" totales en el lote"}</p>
                </div>
              </div>
              <span className="text-amber-700 text-sm font-bold">{verFaltantes?"Ocultar":"Ver"}</span>
            </button>
          ):(
            <div className="w-full bg-emerald-50 border border-emerald-300 rounded-xl px-4 py-3 flex items-center gap-2">
              <span className="text-xl">✅</span>
              <p className="text-emerald-700 font-bold text-sm">Se pesaron todos los animales del lote</p>
            </div>
          )
        )}

        {verFaltantes&&faltantes.length>0&&(
          <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto border-t border-b border-amber-200 py-2">
            {[...faltantes].sort(function(a,b){return a.caravana.localeCompare(b.caravana);}).map(function(a){
              return(
                <button key={a.id} onClick={function(){if(onVerAnimal)onVerAnimal(a.id);}} className="w-full text-left flex items-center justify-between bg-amber-50 hover:bg-amber-100 active:bg-amber-100 border border-amber-200 rounded-xl px-3 py-2 transition-colors">
                  <div className="flex items-center gap-2">
                    <div className="bg-white rounded-xl w-9 h-9 flex items-center justify-center font-black text-amber-700 border border-amber-200 text-xs">{a.caravana.slice(-2)}</div>
                    <div>
                      <p className="text-gray-900 font-bold text-sm">{a.caravana}</p>
                      <p className="text-gray-500 text-xs">{a.sexo+" · "+a.categoria}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {(a.marcas||[]).length>0&&<span className="text-sm">{a.marcas.map(function(m){return colorEmoji(m.color);}).join(" ")}</span>}
                    <span className="text-amber-500 text-lg">›</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        <button onClick={function(){setExportData(exportDatosSesion(sesion,nombreLote));}} className="w-full bg-gray-50 border border-gray-200 text-gray-700 font-bold py-2.5 rounded-xl text-sm">📊 Exportar a Excel</button>
        {exportData&&<ExportModal {...exportData} onClose={function(){setExportData(null);}}/>}
        <div className="flex flex-col gap-1.5 max-h-60 overflow-y-auto">
          {regs.map(function(r){
            return(
              <div key={r.id} className="flex items-center justify-between bg-white border border-gray-200 rounded-xl px-3 py-2">
                <div>
                  <p className="text-gray-800 font-bold text-sm">{r.caravana}</p>
                  <p className="text-gray-500 text-xs">{r.categoria}</p>
                </div>
                <div className="text-right">
                  <p className="text-gray-900 font-bold">{r.peso+" kg"}</p>
                  {r.kgGanados!==null&&r.kgGanados!==undefined&&<p className={"text-xs "+(r.kgGanados>=0?"text-green-400":"text-red-400")}>{(r.kgGanados>0?"+":"")+r.kgGanados+" kg"}</p>}
                  {r.gdpAnimal!==null&&r.gdpAnimal!==undefined&&<p className="text-gray-600 text-xs">{r.gdpAnimal+" kg/d"}</p>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}

// ── Historial Modal ───────────────────────────────────────────────────────────
function HistorialModal({sesiones,onClose,onVerSesion,onEliminarSesion}){
  var [ask,confirmDialog]=useConfirm();
  var [modoComparar,setModoComparar]=useState(false);
  var [sel,setSel]=useState([]); // array de ids
  var [comparar,setComparar]=useState(null); // {a, b}
  var [anioFiltro,setAnioFiltro]=useState("");
  var [showPeriodo,setShowPeriodo]=useState(false);
  var [pDesde,setPDesde]=useState("");
  var [pHasta,setPHasta]=useState("");
  var [resPeriodo,setResPeriodo]=useState(null);

  function calcPeriodo(){
    if(!pDesde||!pHasta){alert("Completá las dos fechas");return;}
    if(pDesde>pHasta){alert("La fecha 'desde' debe ser anterior a 'hasta'");return;}
    var sesEn=sesiones.filter(function(s){return s.fecha>=pDesde&&s.fecha<=pHasta;});
    if(sesEn.length<2){alert("Se necesitan al menos 2 sesiones en el período");return;}
    sesEn.sort(function(a,b){return a.fecha.localeCompare(b.fecha);});
    var prim=sesEn[0],ult=sesEn[sesEn.length-1];
    // Para cada animal en común, ver kg ganados
    var en={},mapU={};
    prim.registros.forEach(function(r){en[r.caravana]=r.peso;});
    ult.registros.forEach(function(r){mapU[r.caravana]=r.peso;});
    var kgs=[],comunes=0;
    Object.keys(en).forEach(function(c){
      if(mapU[c]!==undefined){
        comunes++;
        kgs.push(mapU[c]-en[c]);
      }
    });
    if(comunes===0){alert("No hay animales en común entre las sesiones del período");return;}
    var totalKg=kgs.reduce(function(s,v){return s+v;},0);
    var prom=totalKg/comunes;
    var dias=Math.round((new Date(ult.fecha)-new Date(prim.fecha))/86400000);
    var gdpProm=dias>0?(prom/dias).toFixed(3):null;
    setResPeriodo({totalKg:totalKg,comunes:comunes,prom:prom,dias:dias,gdpProm:gdpProm,sesiones:sesEn.length,desde:prim.fecha,hasta:ult.fecha});
  }

  var sorted=[...sesiones].sort(function(a,b){return b.fecha.localeCompare(a.fecha);});
  var aniosDisp=aniosDe(sesiones);
  var filtradasPorAnio=anioFiltro?sorted.filter(function(s){return s.fecha&&s.fecha.substring(0,4)===anioFiltro;}):sorted;

  function toggleSel(id){
    setSel(function(prev){
      if(prev.includes(id))return prev.filter(function(x){return x!==id;});
      if(prev.length>=2)return [prev[1],id]; // Reemplaza el primero
      return [...prev,id];
    });
  }

  function hacerComparacion(){
    if(sel.length!==2)return;
    var s1=sesiones.find(function(x){return x.id===sel[0];});
    var s2=sesiones.find(function(x){return x.id===sel[1];});
    // Ordenar por fecha: a = más vieja, b = más nueva
    var a,b;
    if(new Date(s1.fecha)<=new Date(s2.fecha)){a=s1;b=s2;}else{a=s2;b=s1;}
    setComparar({a,b});
  }

  if(comparar){
    // Cálculos de la comparación
    var a=comparar.a, b=comparar.b;
    var dias=Math.round((new Date(b.fecha)-new Date(a.fecha))/86400000);
    var totalA=a.registros.reduce(function(s,r){return s+r.peso;},0);
    var totalB=b.registros.reduce(function(s,r){return s+r.peso;},0);
    var promA=a.registros.length>0?totalA/a.registros.length:0;
    var promB=b.registros.length>0?totalB/b.registros.length:0;
    // Animales que están en ambas sesiones
    var enAmbas=a.registros.filter(function(ra){
      return b.registros.some(function(rb){return rb.caravana===ra.caravana;});
    }).map(function(ra){
      var rb=b.registros.find(function(x){return x.caravana===ra.caravana;});
      var kgGan=rb.peso-ra.peso;
      var gdp=dias>0?kgGan/dias:0;
      return {caravana:ra.caravana,categoria:ra.categoria,pesoA:ra.peso,pesoB:rb.peso,kgGan:parseFloat(kgGan.toFixed(1)),gdp:parseFloat(gdp.toFixed(3))};
    });
    var kgGanTotal=enAmbas.reduce(function(s,r){return s+r.kgGan;},0);
    var gdpProm=enAmbas.length>0?enAmbas.reduce(function(s,r){return s+r.gdp;},0)/enAmbas.length:0;

    return(
      <Modal title="📊 Comparar sesiones" onClose={function(){setComparar(null);setSel([]);setModoComparar(false);onClose();}}>
        <div className="flex flex-col gap-3">
          <button onClick={function(){setComparar(null);}} className="self-start text-gray-600 text-sm font-bold">← Volver</button>

          <div className="grid grid-cols-2 gap-2">
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 text-center">
              <p className="text-[10px] text-gray-500 uppercase font-bold">Sesión A</p>
              <p className="text-gray-900 font-black text-sm">{fmtFecha(a.fecha)}</p>
              <p className="text-gray-500 text-xs mt-0.5">{a.registros.length+" animales"}</p>
            </div>
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 text-center">
              <p className="text-[10px] text-gray-500 uppercase font-bold">Sesión B</p>
              <p className="text-gray-900 font-black text-sm">{fmtFecha(b.fecha)}</p>
              <p className="text-gray-500 text-xs mt-0.5">{b.registros.length+" animales"}</p>
            </div>
          </div>

          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-center">
            <p className="text-[10px] text-emerald-600 uppercase font-bold">Período</p>
            <p className="text-emerald-700 font-black text-lg">{dias+" días"}</p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="bg-white border border-gray-200 rounded-xl p-3 text-center">
              <p className="text-[10px] text-gray-500 uppercase font-bold">Prom. kg A</p>
              <p className="text-gray-900 font-black">{promA.toFixed(1)+" kg"}</p>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-3 text-center">
              <p className="text-[10px] text-gray-500 uppercase font-bold">Prom. kg B</p>
              <p className="text-gray-900 font-black">{promB.toFixed(1)+" kg"}</p>
            </div>
          </div>

          {enAmbas.length>0?(
            <>
              <div className={"rounded-xl p-3 text-center border "+(kgGanTotal>=0?"bg-emerald-50 border-emerald-200":"bg-red-50 border-red-200")}>
                <p className="text-[10px] uppercase font-bold text-gray-500">Kg ganados (en {enAmbas.length} animales comunes)</p>
                <p className={"font-black text-2xl "+(kgGanTotal>=0?"text-emerald-700":"text-red-700")}>{(kgGanTotal>=0?"+":"")+kgGanTotal.toFixed(1)+" kg"}</p>
                <p className={"text-sm font-bold "+(gdpProm>=0?"text-emerald-600":"text-red-600")}>{"GDP: "+(gdpProm>=0?"+":"")+gdpProm.toFixed(3)+" kg/d"}</p>
              </div>

              <p className="text-[10px] text-gray-500 uppercase font-bold mt-2">Detalle por animal</p>
              <div className="flex flex-col gap-1 max-h-64 overflow-y-auto">
                {[...enAmbas].sort(function(x,y){return y.kgGan-x.kgGan;}).map(function(r){
                  return(
                    <div key={r.caravana} className="flex items-center justify-between bg-white border border-gray-200 rounded-xl px-3 py-2">
                      <div>
                        <p className="text-gray-900 font-bold text-sm">{r.caravana}</p>
                        <p className="text-gray-500 text-xs">{r.pesoA+" → "+r.pesoB+" kg"}</p>
                      </div>
                      <div className="text-right">
                        <p className={"font-bold text-sm "+(r.kgGan>=0?"text-emerald-600":"text-red-600")}>{(r.kgGan>=0?"+":"")+r.kgGan+" kg"}</p>
                        <p className={"text-xs "+(r.gdp>=0?"text-emerald-500":"text-red-500")}>{(r.gdp>=0?"+":"")+r.gdp+" kg/d"}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          ):(
            <p className="text-center text-gray-500 text-sm py-4">No hay animales en común entre ambas sesiones</p>
          )}
        </div>
      </Modal>
    );
  }

  return(
    <Modal title="📅 Historial" onClose={onClose}>
      <div className="flex flex-col gap-2">
        {sesiones.length>=2&&(
          <div className="flex gap-2 mb-1">
            <button onClick={function(){setModoComparar(function(v){return !v;});setSel([]);}} className={"flex-1 py-2 rounded-xl text-sm font-bold border "+(modoComparar?"bg-gray-900 border-gray-900 text-white":"bg-white border-gray-200 text-gray-700")}>
              {modoComparar?"✕ Cancelar":"📊 Comparar 2 sesiones"}
            </button>
            {modoComparar&&sel.length===2&&(
              <button onClick={hacerComparacion} className="flex-1 py-2 rounded-xl text-sm font-bold bg-emerald-500 border border-emerald-500 text-white">Comparar →</button>
            )}
          </div>
        )}
        {modoComparar&&sel.length>0&&sel.length<2&&<p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">Seleccioná {2-sel.length} sesión más</p>}

        {sesiones.length>=2&&!modoComparar&&(
          <button onClick={function(){setShowPeriodo(function(v){return !v;});setResPeriodo(null);}} className={"w-full py-2 rounded-xl text-sm font-bold border "+(showPeriodo?"bg-emerald-100 border-emerald-300 text-emerald-800":"bg-white border-gray-200 text-gray-700")}>
            {showPeriodo?"✕ Cerrar período":"📊 Ganancia entre fechas"}
          </button>
        )}

        {showPeriodo&&(
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 flex flex-col gap-2">
            <p className="text-xs font-black text-emerald-700 uppercase">📊 Calcular kg ganados en un período</p>
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] text-emerald-600 font-bold uppercase">Desde</label>
                <input type="date" value={pDesde} onChange={function(e){setPDesde(e.target.value);}} className="bg-white border border-emerald-200 rounded-xl px-2 py-2 text-gray-800 text-sm focus:outline-none"/>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] text-emerald-600 font-bold uppercase">Hasta</label>
                <input type="date" value={pHasta} onChange={function(e){setPHasta(e.target.value);}} className="bg-white border border-emerald-200 rounded-xl px-2 py-2 text-gray-800 text-sm focus:outline-none"/>
              </div>
            </div>
            <button onClick={calcPeriodo} className="w-full bg-emerald-300 text-white font-bold py-2 rounded-xl text-sm border border-emerald-300">Calcular</button>
            {resPeriodo&&(
              <div className="bg-white border border-emerald-200 rounded-xl p-3 flex flex-col gap-1.5">
                <p className="text-[10px] text-emerald-600 uppercase font-bold">Resultado · {fmtFecha(resPeriodo.desde)} → {fmtFecha(resPeriodo.hasta)}</p>
                <div className="grid grid-cols-2 gap-2 mt-1">
                  <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-2 text-center">
                    <p className="text-xl font-black text-emerald-700">{"+"+Math.round(resPeriodo.totalKg).toLocaleString("es-AR")}</p>
                    <p className="text-[9px] text-emerald-600 uppercase">Kg totales</p>
                  </div>
                  <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-2 text-center">
                    <p className="text-xl font-black text-emerald-700">{"+"+resPeriodo.prom.toFixed(1)}</p>
                    <p className="text-[9px] text-emerald-600 uppercase">Kg/animal</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-2 text-center">
                    <p className="text-base font-black text-gray-800">{resPeriodo.comunes}</p>
                    <p className="text-[9px] text-gray-500 uppercase">Animales</p>
                  </div>
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-2 text-center">
                    <p className="text-base font-black text-gray-800">{resPeriodo.gdpProm?resPeriodo.gdpProm:"—"}</p>
                    <p className="text-[9px] text-gray-500 uppercase">GDP kg/d</p>
                  </div>
                </div>
                <p className="text-[10px] text-gray-500 text-center">{resPeriodo.dias+" días · "+resPeriodo.sesiones+" sesiones en el período"}</p>
              </div>
            )}
          </div>
        )}

        {aniosDisp.length>1&&<FiltroAnio anios={aniosDisp} valor={anioFiltro} onChange={function(e){setAnioFiltro(e.target.value);}} total={sorted.length} filtrados={filtradasPorAnio.length}/>}

        {filtradasPorAnio.length===0&&(
          <div className="text-center py-8">
            <p className="text-4xl mb-2">⚖️</p>
            <p className="text-gray-700 font-bold text-sm mb-1">{anioFiltro?"Sin sesiones en "+anioFiltro:"Aún no hiciste pesajes"}</p>
            <p className="text-gray-400 text-xs">{anioFiltro?"Probá con otro año":"Iniciá una sesión desde Pesar"}</p>
          </div>
        )}
        {filtradasPorAnio.map(function(s){
          var totalKg=s.registros.reduce(function(acc,r){return acc+r.peso;},0);
          var selected=sel.includes(s.id);
          return(
            <div key={s.id} className={"border rounded-xl px-4 py-3 flex items-center justify-between "+(selected?"bg-emerald-50 border-emerald-400":"bg-white border-gray-200")}>
              <button onClick={function(){if(modoComparar)toggleSel(s.id);else onVerSesion(s);}} className="text-left flex-1 flex items-center gap-3">
                {modoComparar&&(
                  <div className={"w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 "+(selected?"bg-emerald-500 border-emerald-500 text-white":"bg-white border-gray-300 text-transparent")}>
                    ✓
                  </div>
                )}
                <div>
                  <p className="text-gray-800 font-bold text-sm">{fmtFecha(s.fecha)}</p>
                  <p className="text-gray-500 text-xs">{s.registros.length+" animales · "+totalKg.toLocaleString("es-AR")+" kg"}</p>
                  {s.nota&&<p className="text-gray-500 text-xs italic">📝 {s.nota}</p>}
                </div>
              </button>
              {!modoComparar&&<button onClick={function(){ask("¿Eliminar esta sesión?",function(){onEliminarSesion(s.id);});}} className="text-red-500 text-lg ml-3">✕</button>}
            </div>
          );
        })}
      </div>
      {confirmDialog}
    </Modal>
  );
}

// ── Sanidad Masiva Modal ──────────────────────────────────────────────────────
function SanidadMasivaModal({lote,onClose,onUpdate,onCrearAlerta,onUpdateSesiones}){
  var animales=lote.animales||[];
  var sesiones=lote.sanidadSesiones||[];
  var [modo,setModo]=useState("config"); // config -> manga -> resumen | verSesion
  var [seleccion,setSeleccion]=useState("todos"); // todos | manual
  var [formSesion,setFormSesion]=useState({tipo:"Vacuna",nombre:"",fecha:hoy(),proxima:"",dosis:"",obs:""});
  var [seleccionados,setSeleccionados]=useState([]); // ids de animales registrados
  var [busq,setBusq]=useState("");
  var [encontrada,setEncontrada]=useState(null);
  var [crearAlertaProx,setCrearAlertaProx]=useState(true);
  var [verSesion,setVerSesion]=useState(null);
  var [anioFiltro,setAnioFiltro]=useState("");
  var busqRef=useRef();
  var [ask,confirmDialog]=useConfirm();

  function setF(k,v){setFormSesion(function(p){return Object.assign({},p,{[k]:v});});}

  function iniciar(){
    if(!formSesion.nombre.trim()){alert("Falta el nombre del tratamiento");return;}
    if(seleccion==="todos"){
      setSeleccionados(animales.map(function(a){return a.id;}));
    }else{
      setSeleccionados([]);
    }
    setModo("manga");
    if(seleccion==="manual"&&busqRef.current)setTimeout(function(){busqRef.current.focus();},80);
  }

  function buscar(val){
    var q=val.trim().toUpperCase();
    if(!q){setEncontrada(null);return;}
    var match=animales.find(function(a){return a.caravana===q;});
    setEncontrada(match||"notfound");
  }

  function agregar(){
    if(!encontrada||encontrada==="notfound")return;
    if(seleccionados.indexOf(encontrada.id)>=0){
      setBusq("");setEncontrada(null);
      if(busqRef.current)setTimeout(function(){busqRef.current.focus();},80);
      return;
    }
    setSeleccionados([...seleccionados,encontrada.id]);
    setBusq("");setEncontrada(null);
    if(busqRef.current)setTimeout(function(){busqRef.current.focus();},80);
  }

  function quitar(id){
    setSeleccionados(seleccionados.filter(function(x){return x!==id;}));
  }

  function finalizar(){
    if(seleccionados.length===0){alert("No hay animales registrados");return;}
    var nuevoReg={
      tipo:formSesion.tipo,
      nombre:formSesion.nombre.trim(),
      fecha:formSesion.fecha,
      proxima:formSesion.proxima||null,
      dosis:formSesion.dosis||null,
      obs:formSesion.obs||null,
      sesionMasiva:true
    };
    // Capturar caravanas para la sesión guardada
    var animalesTratados=animales.filter(function(a){return seleccionados.indexOf(a.id)>=0;});
    var caravanas=animalesTratados.map(function(a){return {id:a.id,caravana:a.caravana,sexo:a.sexo,categoria:a.categoria};});

    var animalesAct=animales.map(function(a){
      if(seleccionados.indexOf(a.id)===-1)return a;
      return Object.assign({},a,{sanidad:[...(a.sanidad||[]),Object.assign({},nuevoReg,{id:Date.now()+Math.random()})]});
    });
    onUpdate(animalesAct);

    // Guardar la sesión en el lote
    if(onUpdateSesiones){
      var nuevaSesion=Object.assign({id:Date.now(),caravanas:caravanas},nuevoReg);
      onUpdateSesiones([...sesiones,nuevaSesion]);
    }

    if(formSesion.proxima&&crearAlertaProx&&onCrearAlerta){
      onCrearAlerta({
        titulo:formSesion.nombre+" (refuerzo)",
        fechaHora:formSesion.proxima+"T08:00",
        tipo:"sanidad",
        loteId:String(lote.id),
        nota:"Refuerzo "+formSesion.tipo.toLowerCase()+" para "+seleccionados.length+" animales del lote "+lote.nombre
      });
    }

    setModo("resumen");
  }

  function eliminarSesion(id){
    if(onUpdateSesiones){
      onUpdateSesiones(sesiones.filter(function(s){return s.id!==id;}));
    }
  }

  // ── VER DETALLE DE SESIÓN ──
  if(verSesion){
    var s=verSesion;
    return(
      <Modal title={"💊 "+s.tipo+" · "+fmtFecha(s.fecha)} onClose={function(){setVerSesion(null);}}>
        <div className="flex flex-col gap-3">
          <button onClick={function(){setVerSesion(null);}} className="text-gray-700 text-sm font-bold text-left">← Volver al historial</button>

          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 flex flex-col gap-1">
            <p className="text-emerald-800 font-black text-base">{s.nombre}</p>
            <p className="text-emerald-600 text-xs">{s.tipo}</p>
            <p className="text-emerald-500 text-xs">{fmtFecha(s.fecha)}</p>
          </div>

          {(s.dosis||s.proxima||s.obs)&&(
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 flex flex-col gap-1">
              {s.dosis&&<p className="text-gray-800 text-sm"><b>Dosis:</b> {s.dosis}</p>}
              {s.proxima&&<p className="text-gray-800 text-sm"><b>Próxima dosis:</b> {fmtFecha(s.proxima)}</p>}
              {s.obs&&<p className="text-gray-800 text-sm"><b>Obs:</b> {s.obs}</p>}
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <p className="text-xs font-black text-gray-500 uppercase">{(s.caravanas||[]).length+" animales tratados"}</p>
            <div className="flex flex-col gap-1 max-h-72 overflow-y-auto">
              {(s.caravanas||[]).map(function(c){
                return(
                  <div key={c.id} className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 flex items-center justify-between">
                    <p className="text-gray-900 font-bold text-sm">{c.caravana}</p>
                    <p className="text-gray-500 text-xs">{(c.sexo||"")+" · "+(c.categoria||"")}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </Modal>
    );
  }

  if(modo==="config"){
    var aniosDisp=aniosDe(sesiones);
    var sesOrd=[...sesiones].sort(function(a,b){return b.fecha.localeCompare(a.fecha);});
    var sesFiltradas=anioFiltro?sesOrd.filter(function(x){return x.fecha&&x.fecha.substring(0,4)===anioFiltro;}):sesOrd;
    return(
      <Modal title="💊 Sanidad masiva" onClose={onClose}>
        <div className="flex flex-col gap-3">
          <p className="text-xs text-gray-500">Registrá vacunas, antiparasitarios o tratamientos a varios animales a la vez.</p>

          <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 flex flex-col gap-2">
            <p className="text-xs font-black text-green-600 uppercase">Datos del tratamiento</p>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-gray-500 font-bold uppercase">Tipo</label>
              <select value={formSesion.tipo} onChange={function(e){setF("tipo",e.target.value);}} className="bg-white border border-gray-200 rounded-xl px-3 py-2.5 text-gray-900 text-sm focus:outline-none">
                <option>Vacuna</option>
                <option>Antiparasitario</option>
                <option>Tratamiento / Antibiótico</option>
                <option>Suplemento / Vitaminas</option>
                <option>Otro</option>
              </select>
            </div>
            <Inp label="Nombre/Producto *" placeholder="Ej: Aftosa, Ivermectina, Vitamina A..." value={formSesion.nombre} onChange={function(e){setF("nombre",e.target.value);}}/>
            <div className="grid grid-cols-2 gap-2">
              <Inp label="Fecha" type="date" value={formSesion.fecha} onChange={function(e){setF("fecha",e.target.value);}}/>
              <Inp label="Dosis (opcional)" placeholder="Ej: 2 ml" value={formSesion.dosis} onChange={function(e){setF("dosis",e.target.value);}}/>
            </div>
            <Inp label="Próxima dosis (opcional)" type="date" value={formSesion.proxima} onChange={function(e){setF("proxima",e.target.value);}}/>
            {formSesion.proxima&&(
              <label className="flex items-center gap-2 cursor-pointer bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                <input type="checkbox" checked={crearAlertaProx} onChange={function(e){setCrearAlertaProx(e.target.checked);}} className="w-4 h-4"/>
                <span className="text-xs text-amber-800 font-bold">🔔 Crear alerta automática para esa fecha</span>
              </label>
            )}
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-gray-500 font-bold uppercase">Observaciones</label>
              <textarea rows={2} value={formSesion.obs} onChange={function(e){setF("obs",e.target.value);}} placeholder="Opcional..."
                className="bg-white border border-gray-200 rounded-xl px-3 py-2 text-gray-800 text-sm focus:outline-none focus:border-green-400 resize-none"/>
            </div>
          </div>

          <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 flex flex-col gap-2">
            <p className="text-xs font-black text-green-600 uppercase">¿A qué animales?</p>
            <button onClick={function(){setSeleccion("todos");}} className={"w-full text-left rounded-xl border px-3 py-2.5 flex items-center gap-2 "+(seleccion==="todos"?"bg-emerald-100 border-emerald-300":"bg-white border-gray-200")}>
              <span className="text-xl">🐂</span>
              <div className="flex-1">
                <p className="font-bold text-sm text-gray-900">Todos los del lote</p>
                <p className="text-[10px] text-gray-500">{animales.length+" animales"}</p>
              </div>
              {seleccion==="todos"&&<span className="text-emerald-600 font-black">✓</span>}
            </button>
            <button onClick={function(){setSeleccion("manual");}} className={"w-full text-left rounded-xl border px-3 py-2.5 flex items-center gap-2 "+(seleccion==="manual"?"bg-emerald-100 border-emerald-300":"bg-white border-gray-200")}>
              <span className="text-xl">🔍</span>
              <div className="flex-1">
                <p className="font-bold text-sm text-gray-900">Buscar uno por uno</p>
                <p className="text-[10px] text-gray-500">Cargás cada caravana en la manga</p>
              </div>
              {seleccion==="manual"&&<span className="text-emerald-600 font-black">✓</span>}
            </button>
          </div>

          <button onClick={iniciar} style={{boxShadow:"0 1px 3px rgba(0,0,0,0.12)"}} className="w-full bg-emerald-300 text-white font-black py-3 rounded-xl text-base border border-emerald-300">▶ Comenzar</button>

          {/* Historial de sesiones de sanidad masiva */}
          {sesiones.length>0&&(
            <div className="border-t border-gray-200 pt-3 flex flex-col gap-2">
              <p className="text-xs font-black text-gray-500 uppercase">📜 Historial de sanidad masiva</p>
              {aniosDisp.length>1&&<FiltroAnio anios={aniosDisp} valor={anioFiltro} onChange={function(e){setAnioFiltro(e.target.value);}} total={sesiones.length} filtrados={sesFiltradas.length}/>}
              {sesFiltradas.length===0&&<p className="text-gray-400 text-xs text-center py-2">{anioFiltro?"Sin sesiones en "+anioFiltro:"Sin sesiones guardadas"}</p>}
              {sesFiltradas.map(function(s){
                var iconoTipo=s.tipo==="Vacuna"?"💉":s.tipo==="Antiparasitario"?"🪱":s.tipo==="Tratamiento / Antibiótico"?"💊":s.tipo==="Suplemento / Vitaminas"?"🧪":"🩹";
                return(
                  <div key={s.id} className="bg-purple-50 border border-purple-200 rounded-xl px-3 py-2.5 flex items-center justify-between">
                    <button onClick={function(){setVerSesion(s);}} className="flex-1 text-left">
                      <p className="text-purple-900 font-black text-sm">{iconoTipo+" "+s.nombre}</p>
                      <p className="text-purple-600 text-xs">{fmtFecha(s.fecha)+" · "+(s.caravanas||[]).length+" animales"}</p>
                      {s.proxima&&<p className="text-amber-700 text-[10px]">📅 Próx: {fmtFecha(s.proxima)}</p>}
                    </button>
                    <button onClick={function(){ask("¿Eliminar esta sesión?",function(){eliminarSesion(s.id);});}} className="text-red-500 text-lg ml-2">✕</button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        {confirmDialog}
      </Modal>
    );
  }

  if(modo==="manga"){
    var seleccionadosAnim=animales.filter(function(a){return seleccionados.indexOf(a.id)>=0;});
    return(
      <Modal title={"💊