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
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600;700;900&display=swap" rel="stylesheet"/>
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
      <Modal title={"💊 "+formSesion.tipo+" · "+formSesion.nombre} onClose={function(){
        if(seleccionados.length>0){ask("¿Salir sin guardar? Se perderá el registro.",function(){onClose();});}
        else onClose();
      }}>
        <div className="flex flex-col gap-3">
          <button onClick={function(){
            if(seleccionados.length>0){ask("¿Volver a configurar? Se perderá el registro.",function(){setModo("config");setSeleccionados([]);});}
            else setModo("config");
          }} className="text-gray-700 text-sm font-bold text-left">← Volver a configuración</button>

          <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 flex items-center justify-between">
            <p className="text-emerald-800 font-bold text-sm">{seleccionados.length+" / "+animales.length+" animales"}</p>
            <button onClick={finalizar} disabled={seleccionados.length===0} style={{boxShadow:"0 1px 2px rgba(0,0,0,0.1)"}} className={"font-black px-4 py-2 rounded-xl text-sm border "+(seleccionados.length===0?"bg-gray-100 border-gray-200 text-gray-400":"bg-emerald-500 border-emerald-500 text-white")}>FIN</button>
          </div>

          {seleccion==="manual"&&(
            <div className="flex flex-col gap-2">
              <Inp label="Buscar caravana" placeholder="Escribí la caravana..." value={busq} onChange={function(e){setBusq(e.target.value);buscar(e.target.value);}} inputRef={busqRef}/>
              {encontrada==="notfound"&&<p className="text-red-600 text-xs font-bold">No se encontró esa caravana en el lote</p>}
              {encontrada&&encontrada!=="notfound"&&(
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 flex items-center justify-between">
                  <div>
                    <p className="text-gray-900 font-bold text-sm">{encontrada.caravana}</p>
                    <p className="text-gray-500 text-xs">{encontrada.sexo+" · "+encontrada.categoria}</p>
                  </div>
                  <button onClick={agregar} className="bg-emerald-300 text-white font-black px-4 py-2 rounded-xl text-sm border border-emerald-300">+ Agregar</button>
                </div>
              )}
            </div>
          )}

          {seleccion==="todos"&&(
            <p className="text-xs text-gray-500 text-center bg-gray-50 border border-gray-200 rounded-xl py-2">Seleccionados todos los animales. Podés quitar alguno tocando ✕.</p>
          )}

          <div className="flex flex-col gap-1.5 max-h-72 overflow-y-auto">
            {seleccionadosAnim.length===0&&seleccion==="manual"&&(
              <p className="text-gray-400 text-center py-6 text-sm">Buscá animales para agregar al tratamiento</p>
            )}
            {seleccionadosAnim.map(function(a){
              return(
                <div key={a.id} className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 flex items-center justify-between">
                  <div>
                    <p className="text-gray-900 font-bold text-sm">{a.caravana}</p>
                    <p className="text-gray-500 text-xs">{a.sexo+" · "+a.categoria}</p>
                  </div>
                  <button onClick={function(){quitar(a.id);}} className="text-red-500 text-lg">✕</button>
                </div>
              );
            })}
          </div>
        </div>
        {confirmDialog}
      </Modal>
    );
  }

  if(modo==="resumen"){
    return(
      <Modal title={"✅ Sanidad masiva"} onClose={onClose}>
        <div className="flex flex-col gap-3">
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-center">
            <p className="text-5xl mb-2">💉</p>
            <p className="text-emerald-800 font-black text-lg">{seleccionados.length+" animales tratados"}</p>
            <p className="text-emerald-600 text-sm mt-1">{formSesion.tipo+" · "+formSesion.nombre}</p>
            <p className="text-emerald-500 text-xs">{fmtFecha(formSesion.fecha)}</p>
          </div>

          {formSesion.proxima&&(
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-center">
              <p className="text-[10px] text-amber-700 uppercase font-bold">📅 Próxima dosis</p>
              <p className="text-amber-800 font-black text-base">{fmtFecha(formSesion.proxima)}</p>
              {crearAlertaProx&&<p className="text-amber-600 text-[10px] mt-1">🔔 Alerta creada automáticamente</p>}
            </div>
          )}

          <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 flex flex-col gap-1">
            <p className="text-xs text-gray-500 uppercase font-bold mb-1">Detalles</p>
            {formSesion.dosis&&<p className="text-gray-800 text-sm"><b>Dosis:</b> {formSesion.dosis}</p>}
            {formSesion.obs&&<p className="text-gray-800 text-sm"><b>Obs:</b> {formSesion.obs}</p>}
            <p className="text-gray-500 text-xs mt-1">El registro quedó guardado en la pestaña 💉 Sanidad de cada animal y en el historial.</p>
          </div>

          <button onClick={onClose} className="w-full bg-emerald-300 text-white font-black py-3 rounded-xl text-sm border border-emerald-300">Cerrar</button>
        </div>
      </Modal>
    );
  }

  return null;
}

// ── Cargar Animales Modal (sesión de carga rápida) ───────────────────────────
function CargarAnimalesModal({lote,onClose,onAgregarAnimales}){
  var [form,setForm]=useState({caravana:"",sexo:"Hembra",categoria:"Vaquillona",raza:"",fechaNac:"",peso:""});
  var [pendientes,setPendientes]=useState([]);
  var [ask,confirmDialog]=useConfirm();
  var caravRef=useRef();

  function setF(k,v){setForm(function(p){return Object.assign({},p,{[k]:v});});}

  function agregar(){
    var c=form.caravana.trim().toUpperCase();
    if(!c){alert("Falta la caravana");return;}
    if((lote.animales||[]).some(function(a){return a.caravana===c;})){
      alert("Ya existe un animal con caravana "+c+" en este lote");
      return;
    }
    if(pendientes.some(function(p){return p.caravana===c;})){
      alert("Ya cargaste la caravana "+c+" en esta sesión");
      return;
    }
    var nuevo={
      id:Date.now()+Math.random(),
      caravana:c,
      sexo:form.sexo,
      categoria:form.categoria,
      raza:form.raza,
      fechaNac:form.fechaNac,
      pesajes:form.peso?[{id:Date.now(),peso:parseFloat(form.peso),fecha:hoy()}]:[]
    };
    setPendientes([...pendientes,nuevo]);
    // Limpiar solo la caravana, dejar el resto para el siguiente
    setForm(function(p){return Object.assign({},p,{caravana:""});});
    if(caravRef.current)setTimeout(function(){caravRef.current.focus();},80);
  }

  function quitar(id){
    setPendientes(pendientes.filter(function(p){return p.id!==id;}));
  }

  function finalizar(){
    if(pendientes.length===0){alert("No cargaste ningún animal");return;}
    onAgregarAnimales(pendientes);
    onClose();
  }

  return(
    <Modal title="🆕 Cargar animales" onClose={function(){
      if(pendientes.length>0){ask("¿Salir sin guardar? Se perderán "+pendientes.length+" animales sin cargar.",function(){onClose();});}
      else onClose();
    }}>
      <div className="flex flex-col gap-3">
        <p className="text-xs text-gray-500">Cargá varios animales seguidos. Los datos se mantienen del anterior, solo cambiás lo que haga falta.</p>

        <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 flex items-center justify-between">
          <p className="text-emerald-800 font-bold text-sm">{pendientes.length+" animales cargados"}</p>
          <button onClick={finalizar} disabled={pendientes.length===0} style={{boxShadow:"0 1px 2px rgba(0,0,0,0.1)"}} className={"font-black px-4 py-2 rounded-xl text-sm border "+(pendientes.length===0?"bg-gray-100 border-gray-200 text-gray-400":"bg-emerald-500 border-emerald-500 text-white")}>FIN</button>
        </div>

        <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 flex flex-col gap-2">
          <Inp label="Caravana *" placeholder="N° caravana" value={form.caravana} onChange={function(e){setF("caravana",e.target.value);}} inputRef={caravRef}/>
          <div className="grid grid-cols-2 gap-2">
            <Sel label="Sexo" options={["Macho","Hembra"]} value={form.sexo} onChange={function(e){setF("sexo",e.target.value);}}/>
            <Sel label="Categoría" options={CATEGORIAS} value={form.categoria} onChange={function(e){setF("categoria",e.target.value);}}/>
          </div>
          <Sel label="Raza" options={RAZAS} value={form.raza} onChange={function(e){setF("raza",e.target.value);}}/>
          <FechaSelector label="Fecha nacimiento (opcional)" value={form.fechaNac} onChange={function(v){setF("fechaNac",v);}} minAnio={new Date().getFullYear()-25}/>
          <Inp label="Peso inicial (opcional)" type="number" placeholder="kg" value={form.peso} onChange={function(e){setF("peso",e.target.value);}}/>
          <button onClick={agregar} style={{boxShadow:"0 1px 2px rgba(0,0,0,0.1)"}} className="w-full bg-emerald-300 text-white font-black py-2.5 rounded-xl text-sm border border-emerald-300">+ Agregar animal</button>
        </div>

        {pendientes.length>0&&(
          <div className="flex flex-col gap-1.5 max-h-72 overflow-y-auto">
            <p className="text-xs font-black text-gray-500 uppercase">Pendientes de guardar</p>
            {[...pendientes].reverse().map(function(p){
              return(
                <div key={p.id} className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 flex items-center justify-between">
                  <div className="flex-1">
                    <p className="text-gray-900 font-black text-sm">{p.caravana}</p>
                    <div className="flex gap-1.5 flex-wrap">
                      <span className="text-[10px] text-gray-500">{p.sexo+" · "+p.categoria}</span>
                      {p.raza&&<span className="text-[10px] text-gray-500">· {p.raza}</span>}
                      {p.pesajes&&p.pesajes.length>0&&<span className="text-[10px] text-emerald-700 font-bold">{p.pesajes[0].peso+"kg"}</span>}
                    </div>
                  </div>
                  <button onClick={function(){quitar(p.id);}} className="text-red-500 text-lg ml-2">✕</button>
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

// ── Marcar / Señalar Animales Modal ──────────────────────────────────────────
function MarcarAnimalesModal({lote,onClose,onUpdate,onUpdateSesiones}){
  var animales=lote.animales||[];
  var sesiones=lote.marcasSesiones||[];
  var [modo,setModo]=useState("config"); // config -> manga -> resumen
  var [form,setForm]=useState({tipo:"Marca a fuego",lugar:"Oreja derecha",descripcion:"",fecha:hoy(),obs:""});
  var [registros,setRegistros]=useState([]); // [{caravana, animalId}]
  var [busq,setBusq]=useState("");
  var [encontrada,setEncontrada]=useState(null);
  var [verSesion,setVerSesion]=useState(null);
  var [anioFiltro,setAnioFiltro]=useState("");
  var busqRef=useRef();
  var [ask,confirmDialog]=useConfirm();

  function setF(k,v){setForm(function(p){return Object.assign({},p,{[k]:v});});}

  function iniciar(){
    if(!form.descripcion.trim()&&form.tipo!=="Marca a fuego"){alert("Falta la descripción");return;}
    setRegistros([]);setBusq("");setEncontrada(null);
    setModo("manga");
    if(busqRef.current)setTimeout(function(){busqRef.current.focus();},80);
  }

  function buscar(val){
    var q=val.trim().toUpperCase();
    if(!q){setEncontrada(null);return;}
    var match=animales.find(function(a){return a.caravana===q;});
    setEncontrada(match||"notfound");
  }

  function agregar(){
    if(!encontrada||encontrada==="notfound")return;
    if(registros.some(function(r){return r.animalId===encontrada.id;})){
      setBusq("");setEncontrada(null);
      if(busqRef.current)setTimeout(function(){busqRef.current.focus();},80);
      return;
    }
    setRegistros([...registros,{animalId:encontrada.id,caravana:encontrada.caravana,sexo:encontrada.sexo,categoria:encontrada.categoria}]);
    setBusq("");setEncontrada(null);
    if(busqRef.current)setTimeout(function(){busqRef.current.focus();},80);
  }

  function quitar(id){
    setRegistros(registros.filter(function(r){return r.animalId!==id;}));
  }

  function finalizar(){
    if(registros.length===0){alert("No registraste ningún animal");return;}
    var nuevoReg={
      tipo:form.tipo,
      lugar:form.lugar,
      descripcion:form.descripcion.trim(),
      fecha:form.fecha,
      obs:form.obs||null
    };
    // Agregar la marca a cada animal en su array de "marcas"
    var animalesAct=animales.map(function(a){
      var encontrado=registros.find(function(r){return r.animalId===a.id;});
      if(!encontrado)return a;
      var marcaAnim=Object.assign({id:Date.now()+Math.random()},nuevoReg);
      return Object.assign({},a,{marcasSenal:[...(a.marcasSenal||[]),marcaAnim]});
    });
    onUpdate(animalesAct);
    if(onUpdateSesiones){
      var sesion=Object.assign({id:Date.now(),caravanas:registros},nuevoReg);
      onUpdateSesiones([...sesiones,sesion]);
    }
    setModo("resumen");
  }

  function eliminarSesion(id){
    if(onUpdateSesiones){
      onUpdateSesiones(sesiones.filter(function(s){return s.id!==id;}));
    }
  }

  // Ver detalle sesión guardada
  if(verSesion){
    var s=verSesion;
    return(
      <Modal title={"🏷️ "+s.tipo+" · "+fmtFecha(s.fecha)} onClose={function(){setVerSesion(null);}}>
        <div className="flex flex-col gap-3">
          <button onClick={function(){setVerSesion(null);}} className="text-gray-700 text-sm font-bold text-left">← Volver al historial</button>
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex flex-col gap-1">
            <p className="text-amber-800 font-black text-base">{s.tipo}</p>
            {s.lugar&&<p className="text-amber-700 text-xs"><b>Lugar:</b> {s.lugar}</p>}
            {s.descripcion&&<p className="text-amber-700 text-xs"><b>Descripción:</b> {s.descripcion}</p>}
            <p className="text-amber-600 text-xs">{fmtFecha(s.fecha)}</p>
            {s.obs&&<p className="text-gray-700 text-xs mt-1"><b>Obs:</b> {s.obs}</p>}
          </div>
          <div className="flex flex-col gap-1.5">
            <p className="text-xs font-black text-gray-500 uppercase">{(s.caravanas||[]).length+" animales marcados"}</p>
            <div className="flex flex-col gap-1 max-h-72 overflow-y-auto">
              {(s.caravanas||[]).map(function(c){
                return(
                  <div key={c.animalId} className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 flex items-center justify-between">
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
      <Modal title="🏷️ Marcar / Señalar" onClose={onClose}>
        <div className="flex flex-col gap-3">
          <p className="text-xs text-gray-500">Registrá marcas, tatuajes, mochetas o aros aplicados a los animales.</p>

          <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 flex flex-col gap-2">
            <p className="text-xs font-black text-green-600 uppercase">Datos de la marca</p>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-gray-500 font-bold uppercase">Tipo</label>
              <select value={form.tipo} onChange={function(e){setF("tipo",e.target.value);}} className="bg-white border border-gray-200 rounded-xl px-3 py-2.5 text-gray-900 text-sm focus:outline-none">
                <option>Marca a fuego</option>
                <option>Tatuaje</option>
                <option>Mocheta</option>
                <option>Aro</option>
                <option>Caravana nueva</option>
                <option>Otro</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-gray-500 font-bold uppercase">Lugar</label>
              <select value={form.lugar} onChange={function(e){setF("lugar",e.target.value);}} className="bg-white border border-gray-200 rounded-xl px-3 py-2.5 text-gray-900 text-sm focus:outline-none">
                <option>Oreja derecha</option>
                <option>Oreja izquierda</option>
                <option>Anca derecha</option>
                <option>Anca izquierda</option>
                <option>Cogote</option>
                <option>Otro</option>
              </select>
            </div>
            <Inp label="Descripción" placeholder="Ej: número, color, código..." value={form.descripcion} onChange={function(e){setF("descripcion",e.target.value);}}/>
            <Inp label="Fecha" type="date" value={form.fecha} onChange={function(e){setF("fecha",e.target.value);}}/>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-gray-500 font-bold uppercase">Observaciones</label>
              <textarea rows={2} value={form.obs} onChange={function(e){setF("obs",e.target.value);}} placeholder="Opcional..."
                className="bg-white border border-gray-200 rounded-xl px-3 py-2 text-gray-800 text-sm focus:outline-none focus:border-green-400 resize-none"/>
            </div>
          </div>

          <button onClick={iniciar} style={{boxShadow:"0 1px 3px rgba(0,0,0,0.12)"}} className="w-full bg-emerald-300 text-white font-black py-3 rounded-xl text-base border border-emerald-300">▶ Comenzar</button>

          {sesiones.length>0&&(
            <div className="border-t border-gray-200 pt-3 flex flex-col gap-2">
              <p className="text-xs font-black text-gray-500 uppercase">📜 Historial de marcas</p>
              {aniosDisp.length>1&&<FiltroAnio anios={aniosDisp} valor={anioFiltro} onChange={function(e){setAnioFiltro(e.target.value);}} total={sesiones.length} filtrados={sesFiltradas.length}/>}
              {sesFiltradas.length===0&&<p className="text-gray-400 text-xs text-center py-2">{anioFiltro?"Sin sesiones en "+anioFiltro:"Sin sesiones guardadas"}</p>}
              {sesFiltradas.map(function(s){
                return(
                  <div key={s.id} className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 flex items-center justify-between">
                    <button onClick={function(){setVerSesion(s);}} className="flex-1 text-left">
                      <p className="text-amber-900 font-black text-sm">🏷️ {s.tipo}{s.descripcion?" · "+s.descripcion:""}</p>
                      <p className="text-amber-600 text-xs">{fmtFecha(s.fecha)+" · "+(s.caravanas||[]).length+" animales"}</p>
                      {s.lugar&&<p className="text-amber-500 text-[10px]">📍 {s.lugar}</p>}
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
    return(
      <Modal title={"🏷️ "+form.tipo} onClose={function(){
        if(registros.length>0){ask("¿Salir sin guardar?",function(){onClose();});}
        else onClose();
      }}>
        <div className="flex flex-col gap-3">
          <button onClick={function(){
            if(registros.length>0){ask("¿Volver a configurar? Se perderá el registro.",function(){setModo("config");setRegistros([]);});}
            else setModo("config");
          }} className="text-gray-700 text-sm font-bold text-left">← Volver a configuración</button>

          <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 flex items-center justify-between">
            <p className="text-emerald-800 font-bold text-sm">{registros.length+" animales marcados"}</p>
            <button onClick={finalizar} disabled={registros.length===0} style={{boxShadow:"0 1px 2px rgba(0,0,0,0.1)"}} className={"font-black px-4 py-2 rounded-xl text-sm border "+(registros.length===0?"bg-gray-100 border-gray-200 text-gray-400":"bg-emerald-500 border-emerald-500 text-white")}>FIN</button>
          </div>

          <div className="flex flex-col gap-2">
            <Inp label="Buscar caravana" placeholder="Escribí la caravana..." value={busq} onChange={function(e){setBusq(e.target.value);buscar(e.target.value);}} inputRef={busqRef}/>
            {encontrada==="notfound"&&<p className="text-red-600 text-xs font-bold">No se encontró esa caravana en el lote</p>}
            {encontrada&&encontrada!=="notfound"&&(
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 flex items-center justify-between">
                <div>
                  <p className="text-gray-900 font-bold text-sm">{encontrada.caravana}</p>
                  <p className="text-gray-500 text-xs">{encontrada.sexo+" · "+encontrada.categoria}</p>
                </div>
                <button onClick={agregar} className="bg-emerald-300 text-white font-black px-4 py-2 rounded-xl text-sm border border-emerald-300">+ Marcar</button>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-1.5 max-h-72 overflow-y-auto">
            {registros.length===0&&<p className="text-gray-400 text-center py-6 text-sm">Buscá animales para marcar</p>}
            {[...registros].reverse().map(function(r){
              return(
                <div key={r.animalId} className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 flex items-center justify-between">
                  <div>
                    <p className="text-gray-900 font-bold text-sm">{r.caravana}</p>
                    <p className="text-gray-500 text-xs">{r.sexo+" · "+r.categoria}</p>
                  </div>
                  <button onClick={function(){quitar(r.animalId);}} className="text-red-500 text-lg">✕</button>
                </div>
              );
            })}
          </div>
        </div>
        {confirmDialog}
      </Modal>
    );
  }

  if(modo==="resumen"){
    return(
      <Modal title="✅ Marca registrada" onClose={onClose}>
        <div className="flex flex-col gap-3">
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-center">
            <p className="text-5xl mb-2">🏷️</p>
            <p className="text-emerald-800 font-black text-lg">{registros.length+" animales marcados"}</p>
            <p className="text-emerald-600 text-sm mt-1">{form.tipo+(form.descripcion?" · "+form.descripcion:"")}</p>
            <p className="text-emerald-500 text-xs">{fmtFecha(form.fecha)}</p>
          </div>
          <button onClick={onClose} className="w-full bg-emerald-300 text-white font-black py-3 rounded-xl text-sm border border-emerald-300">Cerrar</button>
        </div>
      </Modal>
    );
  }

  return null;
}

// ── Repro Modal ───────────────────────────────────────────────────────────────
function ReproModal({lote,onClose,onUpdate,toros,tipoDirecto}){
  var animales=lote.animales||[];
  var hembras=animales.filter(function(a){return a.sexo==="Hembra";});
  var sesiones=lote.reproSesiones||[];
  var [modo,setModo]=useState("menu");
  var [sesionActual,setSesionActual]=useState(null);
  var [log,setLog]=useState([]);
  var [tipoSesion,setTipoSesion]=useState("tacto");
  var [busq,setBusq]=useState("");
  var [encontrada,setEncontrada]=useState(null);
  var [form,setForm]=useState({resultado:"Preñada",tipo:"Natural",toro:"",vivo:true,sexoTernero:"Macho",caravanaTernero:"",obs:"",fechaServicio:hoy()});
  var busqRef=useRef();
  var [ask,confirmDialog]=useConfirm();
  var [exportRepro,setExportRepro]=useState(null);
  var [anioRepro,setAnioRepro]=useState("");
  var [showAnalisis,setShowAnalisis]=useState(false);

  // Si viene tipoDirecto desde Manga, arrancar la sesión al toque
  useEffect(function(){
    if(tipoDirecto){
      setTipoSesion(tipoDirecto);
      setSesionActual({fecha:hoy(),tipo:tipoDirecto});
      setLog([]);setBusq("");setEncontrada(null);
      setModo("manga");
    }
  },[tipoDirecto]);

  function setF(k,v){setForm(function(p){return Object.assign({},p,{[k]:v});});}

  function iniciar(){
    setSesionActual({fecha:hoy(),tipo:tipoSesion});
    setLog([]);setBusq("");setEncontrada(null);
    setModo("manga");
  }

  function buscar(val){
    var q=val.trim().toUpperCase();
    if(!q){setEncontrada(null);return;}
    var match=animales.find(function(a){return a.caravana===q;});
    setEncontrada(match||"notfound");
  }

  function registrar(){
    if(!encontrada||encontrada==="notfound")return;
    if(log.find(function(r){return r.caravana===encontrada.caravana;})){
      setBusq("");setEncontrada(null);
      if(busqRef.current)setTimeout(function(){busqRef.current.focus();},80);
      return;
    }
    var reg=Object.assign({id:Date.now(),caravana:encontrada.caravana,categoria:encontrada.categoria},form);
    if(sesionActual.tipo==="servicio"){
      reg.fechaPartoProbable=sumarDias(form.fechaServicio,283);
    }
    setLog(function(prev){return [reg,...prev];});
    setBusq("");setEncontrada(null);
    setForm({resultado:"Preñada",tipo:"Natural",toro:"",vivo:true,sexoTernero:"Macho",caravanaTernero:"",obs:"",fechaServicio:hoy()});
    if(busqRef.current)setTimeout(function(){busqRef.current.focus();},80);
  }

  function rodeoCompleto(){
    var noReg=hembras.filter(function(h){return !log.find(function(r){return r.caravana===h.caravana;});});
    var fpStr=sumarDias(form.fechaServicio,283);
    var nuevos=noReg.map(function(h){
      return {id:Date.now()+Math.random(),caravana:h.caravana,categoria:h.categoria,
        tipo:form.tipo,toro:form.toro,fechaServicio:form.fechaServicio,fechaPartoProbable:fpStr,obs:"Servicio masivo"};
    });
    setLog(function(prev){return [...nuevos,...prev];});
  }

  function finalizar(){
    if(log.length===0){setModo("menu");return;}
    var sesion={id:Date.now(),fecha:sesionActual.fecha,tipo:sesionActual.tipo,registros:[...log].reverse()};
    var nuevosAnimales=null;
    if(sesionActual.tipo==="parto"){
      var terneros=[];
      log.forEach(function(r){
        if(r.vivo&&r.caravanaTernero){
          terneros.push({id:Date.now()+Math.random(),caravana:r.caravanaTernero.trim().toUpperCase(),
            sexo:r.sexoTernero,categoria:"Ternero/a",raza:"",fechaNac:sesionActual.fecha,
            obs:"Madre: "+r.caravana,pesajes:[],marcas:[]});
        }
      });
      if(terneros.length>0)nuevosAnimales=[...animales,...terneros];
    }
    onUpdate(sesion,nuevosAnimales);
    setSesionActual(null);setLog([]);setModo("menu");
  }

  // Stats resumen
  var todasSes=[...sesiones];
  var tactos=todasSes.filter(function(s){return s.tipo==="tacto";}).flatMap(function(s){return s.registros;});
  var servicios=todasSes.filter(function(s){return s.tipo==="servicio";}).flatMap(function(s){return s.registros;});
  var partos=todasSes.filter(function(s){return s.tipo==="parto";}).flatMap(function(s){return s.registros;});
  var prenadas=tactos.filter(function(t){return t.resultado==="Preñada";}).length;
  var hoyD=new Date();
  var en60=new Date();en60.setDate(en60.getDate()+60);
  var proxPartos=servicios.filter(function(s){
    if(!s.fechaPartoProbable)return false;
    var fp=new Date(s.fechaPartoProbable+"T12:00:00");
    return fp>=hoyD&&fp<=en60;
  });

  // ── MENU ──
  // ── MODAL ANÁLISIS DEL RODEO ──
  if(showAnalisis){
    var statsAnio={};
    sesiones.forEach(function(s){
      var anio=s.fecha.substring(0,4);
      if(!statsAnio[anio])statsAnio[anio]={servicios:0,tactos:0,prenadas:0,vacias:0,dudosas:0,partos:0,vivos:0,muertos:0,machos:0,hembrasT:0,natural:0,ia:0};
      var st=statsAnio[anio];
      (s.registros||[]).forEach(function(r){
        if(s.tipo==="servicio"){
          st.servicios++;
          if(r.tipo==="Natural")st.natural++;
          else if(r.tipo==="IA")st.ia++;
        }else if(s.tipo==="tacto"){
          st.tactos++;
          if(r.resultado==="Preñada")st.prenadas++;
          else if(r.resultado==="Vacía")st.vacias++;
          else if(r.resultado==="Dudosa")st.dudosas++;
        }else if(s.tipo==="parto"){
          st.partos++;
          if(r.vivo===true)st.vivos++;
          else if(r.vivo===false)st.muertos++;
          if(r.sexoTernero==="Macho")st.machos++;
          else if(r.sexoTernero==="Hembra")st.hembrasT++;
        }
      });
    });
    var aniosOrd=Object.keys(statsAnio).sort(function(a,b){return b.localeCompare(a);});
    var totalHembras=hembras.length;
    return(
      <Modal title="📊 Análisis del rodeo" onClose={function(){setShowAnalisis(false);}}>
        <div className="flex flex-col gap-3">
          <div className="bg-pink-50 border border-pink-200 rounded-xl p-3 text-center">
            <p className="text-[10px] text-pink-600 uppercase font-bold">Vacas en lote</p>
            <p className="text-2xl font-black text-pink-700">{totalHembras}</p>
            <p className="text-[10px] text-pink-500">{lote.nombre}</p>
          </div>

          {aniosOrd.length===0&&<p className="text-gray-400 text-center py-8">Sin datos para analizar</p>}

          {aniosOrd.map(function(a){
            var s=statsAnio[a];
            var tasaPrenez=s.tactos>0?Math.round(s.prenadas/s.tactos*100):null;
            var tasaVivos=s.partos>0?Math.round(s.vivos/s.partos*100):null;
            var efRepro=s.servicios>0?Math.round(s.vivos/s.servicios*100):null;
            return(
              <div key={a} className="border-2 border-pink-300 rounded-xl p-3 bg-pink-50/30 flex flex-col gap-2">
                <p className="text-pink-700 font-black text-base">📅 {a}</p>

                {s.servicios>0&&(
                  <div className="bg-white border border-pink-100 rounded-lg p-2">
                    <p className="text-[10px] text-pink-600 uppercase font-bold mb-1">💉 Servicios</p>
                    <div className="grid grid-cols-3 gap-1 text-center">
                      <div><p className="text-lg font-black text-gray-900">{s.servicios}</p><p className="text-[9px] text-gray-500 uppercase">Total</p></div>
                      <div><p className="text-lg font-black text-gray-700">{s.natural}</p><p className="text-[9px] text-gray-500 uppercase">Natural</p></div>
                      <div><p className="text-lg font-black text-gray-700">{s.ia}</p><p className="text-[9px] text-gray-500 uppercase">IA</p></div>
                    </div>
                  </div>
                )}

                {s.tactos>0&&(
                  <div className="bg-white border border-pink-100 rounded-lg p-2">
                    <p className="text-[10px] text-pink-600 uppercase font-bold mb-1">🔍 Tactos</p>
                    <div className="grid grid-cols-3 gap-1 text-center mb-1">
                      <div><p className="text-lg font-black text-emerald-700">{s.prenadas}</p><p className="text-[9px] text-gray-500 uppercase">Preñadas</p></div>
                      <div><p className="text-lg font-black text-red-600">{s.vacias}</p><p className="text-[9px] text-gray-500 uppercase">Vacías</p></div>
                      <div><p className="text-lg font-black text-amber-600">{s.dudosas}</p><p className="text-[9px] text-gray-500 uppercase">Dudosas</p></div>
                    </div>
                    {tasaPrenez!==null&&(
                      <div className="bg-emerald-50 border border-emerald-200 rounded-md p-1.5 text-center">
                        <p className="text-[9px] text-emerald-700 uppercase font-bold">% Preñez</p>
                        <p className="text-lg font-black text-emerald-700">{tasaPrenez+"%"}</p>
                      </div>
                    )}
                  </div>
                )}

                {s.partos>0&&(
                  <div className="bg-white border border-pink-100 rounded-lg p-2">
                    <p className="text-[10px] text-pink-600 uppercase font-bold mb-1">🐄 Partos</p>
                    <div className="grid grid-cols-2 gap-1 text-center mb-1">
                      <div><p className="text-lg font-black text-emerald-700">{s.vivos}</p><p className="text-[9px] text-gray-500 uppercase">💚 Vivos</p></div>
                      <div><p className="text-lg font-black text-red-600">{s.muertos}</p><p className="text-[9px] text-gray-500 uppercase">💔 Muertos</p></div>
                    </div>
                    <div className="grid grid-cols-2 gap-1 text-center mb-1">
                      <div className="bg-blue-50 border border-blue-200 rounded p-1"><p className="text-sm font-black text-blue-700">{s.machos}</p><p className="text-[9px] text-blue-500 uppercase">♂ Machos</p></div>
                      <div className="bg-pink-50 border border-pink-200 rounded p-1"><p className="text-sm font-black text-pink-700">{s.hembrasT}</p><p className="text-[9px] text-pink-500 uppercase">♀ Hembras</p></div>
                    </div>
                    {tasaVivos!==null&&(
                      <div className="bg-emerald-50 border border-emerald-200 rounded-md p-1.5 text-center">
                        <p className="text-[9px] text-emerald-700 uppercase font-bold">% Vivos</p>
                        <p className="text-lg font-black text-emerald-700">{tasaVivos+"%"}</p>
                      </div>
                    )}
                  </div>
                )}

                {efRepro!==null&&s.servicios>0&&s.partos>0&&(
                  <div className="bg-amber-50 border border-amber-300 rounded-lg p-2 text-center">
                    <p className="text-[10px] text-amber-700 uppercase font-bold">📊 Eficiencia reproductiva</p>
                    <p className="text-xl font-black text-amber-800">{efRepro+"%"}</p>
                    <p className="text-[9px] text-amber-600">{s.vivos+" terneros vivos / "+s.servicios+" servicios"}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Modal>
    );
  }

  if(modo==="menu"){
    return(
      <Modal title="🐄 Gestión Reproductiva" onClose={onClose}>
        <div className="flex flex-col gap-3">
          {sesiones.length>0&&(
            <div className="grid grid-cols-3 gap-2 mb-1">
              <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-center">
                <p className="text-xl font-black text-green-700">{prenadas}</p>
                <p className="text-[10px] text-green-500 uppercase font-bold mt-0.5">Preñadas</p>
              </div>
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 text-center">
                <p className="text-xl font-black text-gray-700">{partos.length}</p>
                <p className="text-[10px] text-gray-400 uppercase font-bold mt-0.5">Partos</p>
              </div>
              <div className={"border rounded-xl p-3 text-center "+(proxPartos.length>0?"bg-amber-50 border-amber-300":"bg-gray-50 border-gray-200")}>
                <p className={"text-xl font-black "+(proxPartos.length>0?"text-amber-600":"text-gray-700")}>{proxPartos.length}</p>
                <p className={"text-[10px] uppercase font-bold mt-0.5 "+(proxPartos.length>0?"text-amber-400":"text-gray-400")}>Prox. partos</p>
              </div>
            </div>
          )}
          {sesiones.length>0&&(
            <button onClick={function(){setShowAnalisis(true);}} style={{boxShadow:"0 1px 2px rgba(0,0,0,0.1)"}} className="w-full bg-rose-100 text-rose-800 font-bold py-2.5 rounded-xl text-sm border border-rose-200">📊 Análisis del rodeo</button>
          )}
          {sesionActual&&log.length>0&&(
            <div className="bg-amber-50 border border-amber-300 rounded-xl px-4 py-3">
              <p className="text-amber-800 font-bold text-sm">{"⏸ Sesión pausada · "+(sesionActual.tipo==="tacto"?"Tacto":sesionActual.tipo==="servicio"?"Servicio":"Partos")}</p>
              <p className="text-amber-600 text-xs">{log.length+" registros"}</p>
              <div className="flex gap-2 mt-2">
                <button onClick={function(){setModo("manga");}} style={{boxShadow:"0 1px 2px rgba(0,0,0,0.1)"}} className="flex-1 bg-amber-400 text-amber-900 font-bold py-2 rounded-xl text-sm border border-amber-400">▶ Retomar</button>
                <button onClick={function(){setSesionActual(null);setLog([]);}} className="flex-1 bg-pink-50 text-pink-600 font-bold py-2 rounded-xl text-sm border border-pink-200">✕ Descartar</button>
              </div>
            </div>
          )}
          <p className="text-xs font-black text-pink-600 uppercase">Nueva sesión</p>
          <div className="grid grid-cols-3 gap-2">
            {[["tacto","🔍","Tacto"],["servicio","💉","Servicio"],["parto","🐄","Parto"]].map(function(item){
              return(
                <button key={item[0]} onClick={function(){setTipoSesion(item[0]);}}
                  className={"flex flex-col items-center py-3 rounded-xl border-2 font-bold text-xs "+(tipoSesion===item[0]?"bg-rose-600 border-rose-300 text-white":"bg-pink-50 border-pink-200 text-pink-600")}>
                  <span className="text-2xl mb-1">{item[1]}</span>{item[2]}
                </button>
              );
            })}
          </div>
          <button onClick={iniciar} style={{boxShadow:"0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.08)"}} className="w-full bg-rose-300 text-white font-black py-3 rounded-xl text-base border border-rose-300">
            {"Iniciar sesión de "+(tipoSesion==="tacto"?"Tacto":tipoSesion==="servicio"?"Servicio":"Partos")}
          </button>
          {sesiones.length>0&&(
            <div className="flex flex-col gap-2 border-t border-pink-200 pt-3">
              <p className="text-xs font-black text-pink-600 uppercase">Historial</p>
              {(function(){
                var aniosR=aniosDe(sesiones);
                if(aniosR.length<=1)return null;
                var filtCount=anioRepro?sesiones.filter(function(s){return s.fecha&&s.fecha.substring(0,4)===anioRepro;}).length:sesiones.length;
                return <FiltroAnio anios={aniosR} valor={anioRepro} onChange={function(e){setAnioRepro(e.target.value);}} total={sesiones.length} filtrados={filtCount}/>;
              })()}
              {[...sesiones].sort(function(a,b){return b.fecha.localeCompare(a.fecha);}).filter(function(s){return !anioRepro||(s.fecha&&s.fecha.substring(0,4)===anioRepro);}).map(function(s){
                return(
                  <button key={s.id} onClick={function(){setSesionActual(Object.assign({},s,{soloVer:true}));setLog(s.registros);setModo("resumen");}}
                    className="w-full text-left bg-pink-50 border border-pink-200 rounded-xl px-4 py-3 flex items-center justify-between">
                    <div>
                      <p className="text-pink-900 font-black text-sm">{fmtFecha(s.fecha)+" · "+(s.tipo==="tacto"?"Tacto":s.tipo==="servicio"?"Servicio":"Partos")}</p>
                      <p className="text-pink-500 text-xs">{s.registros.length+" animales"}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-pink-600 text-xl">›</span>
                      <button onClick={function(e){e.stopPropagation();ask("¿Eliminar sesión?",function(){onUpdate(null,null,s.id);});}} className="text-red-500 text-lg">✕</button>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
          {confirmDialog}
        </div>
      </Modal>
    );
  }

  // ── MANGA REPRO ──
  if(modo==="manga"){
    var yaReg=encontrada&&encontrada!=="notfound"&&log.find(function(r){return r.caravana===encontrada.caravana;});
    var tipoLabel=sesionActual.tipo==="tacto"?"Tacto":sesionActual.tipo==="servicio"?"Servicio":"Partos";
    return(
      <div className="fixed inset-0 z-50 flex flex-col" style={{background:"#ffffff"}}>
        <div style={{background:"#ffffff"}} className=" border-b border-gray-200 px-4 py-3 shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">{"Manga "+tipoLabel+" · "+lote.nombre}</p>
              <h2 className="text-lg font-bold text-gray-900">{"Sesión "+fmtFecha(sesionActual.fecha)}</h2>
            </div>
            <div className="flex gap-2">
              <button onClick={function(){setModo("menu");}} style={{background:"#1a2e10"}} className=" border border-gray-200 text-emerald-700 font-bold px-3 py-1.5 rounded-xl text-xs">⏸ Pausar</button>
              <button onClick={finalizar} style={{boxShadow:"0 1px 2px rgba(0,0,0,0.1)"}} className="btn-flash bg-rose-500 text-white font-black px-4 py-1.5 rounded-xl text-sm border border-rose-400">FIN</button>
            </div>
          </div>
        </div>
        {log.length>0&&(
          <div style={{background:"#ecfdf5"}} className=" border-b border-emerald-200 px-4 py-2 shrink-0 flex gap-4">
            <div className="flex items-center gap-1.5"><span className="text-[10px] text-gray-500 uppercase">Registradas:</span><span className="text-gray-800 font-bold text-sm">{log.length}</span></div>
            {sesionActual.tipo==="tacto"&&<div className="flex items-center gap-1.5"><span className="text-[10px] text-gray-500 uppercase">Preñadas:</span><span className="text-green-300 font-bold text-sm">{log.filter(function(r){return r.resultado==="Preñada";}).length}</span></div>}
            {sesionActual.tipo==="parto"&&<div className="flex items-center gap-1.5"><span className="text-[10px] text-gray-500 uppercase">Vivos:</span><span className="text-green-300 font-bold text-sm">{log.filter(function(r){return r.vivo;}).length}</span></div>}
          </div>
        )}
        <div className="flex-1 overflow-y-auto flex flex-col">
          <div className="px-4 pt-4 pb-3">
            {/* Servicio panel */}
            {sesionActual.tipo==="servicio"&&(
              <div className="mb-3 bg-emerald-50 border border-emerald-200 rounded-xl p-3 flex flex-col gap-2">
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] text-gray-500 uppercase font-bold">Fecha servicio</label>
                    <input type="date" value={form.fechaServicio} onChange={function(e){setF("fechaServicio",e.target.value);}} style={{background:"#f9fafb"}} className=" border border-gray-200 rounded-xl px-2 py-2 text-gray-900 text-sm focus:outline-none"/>
                  </div>
                  <div style={{background:"#f9fafb"}} className=" border border-gray-200 rounded-xl px-3 py-2 flex flex-col justify-center">
                    <p className="text-[10px] text-gray-500 uppercase font-bold">Parto estimado</p>
                    <p className="text-emerald-700 font-black text-sm">{form.fechaServicio?fmtFecha(sumarDias(form.fechaServicio,283)):"—"}</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] text-gray-500 uppercase font-bold">Tipo</label>
                    <select value={form.tipo} onChange={function(e){setF("tipo",e.target.value);}} style={{background:"#f9fafb"}} className=" border border-gray-200 rounded-xl px-2 py-2 text-gray-900 text-sm focus:outline-none">
                      <option>Natural</option><option>I.A.</option><option>E.T.</option>
                    </select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] text-gray-500 uppercase font-bold">Toro</label>
                    <select value={form.toro} onChange={function(e){setF("toro",e.target.value);}} style={{background:"#f9fafb"}} className=" border border-gray-200 rounded-xl px-2 py-2 text-gray-900 text-sm focus:outline-none">
                      <option value="">— Elegir —</option>
                      {(toros||[]).map(function(t){return <option key={t.id} value={t.caravana}>{t.caravana+(t.raza?" · "+t.raza:"")}</option>;})}
                      <option value="__otro">✏️ Otro</option>
                    </select>
                  </div>
                </div>
                <button onClick={rodeoCompleto} style={{boxShadow:"0 1px 2px rgba(0,0,0,0.1)"}} className="w-full bg-emerald-600 text-gray-900 font-black py-2.5 rounded-xl text-sm border border-emerald-600">
                  {"🐄 Rodeo completo ("+hembras.filter(function(h){return !log.find(function(r){return r.caravana===h.caravana;});}).length+" hembras)"}
                </button>
              </div>
            )}
            <label className="text-[10px] text-gray-500 font-bold uppercase tracking-wider block mb-2">📡 Caravana</label>
            <input ref={busqRef} value={busq}
              onChange={function(e){setBusq(e.target.value);buscar(e.target.value);}}
              onKeyDown={function(e){if(e.key==="Enter"){if(encontrada&&encontrada!=="notfound"&&!yaReg)registrar();else buscar(busq);}}}
              placeholder="N° caravana..." autoComplete="off" autoCorrect="off" autoCapitalize="characters" spellCheck="false"
              className="w-full bg-gray-50 border-2 border-gray-200 focus:border-rose-300 rounded-2xl px-4 py-4 text-gray-900 text-2xl font-bold tracking-widest focus:outline-none placeholder-gray-400"/>
            {encontrada&&encontrada!=="notfound"&&(
              <div className={"mt-3 rounded-2xl p-3 border "+(yaReg?"bg-amber-950/30 border-amber-700":"bg-emerald-50 border-emerald-200")}>
                {(encontrada.marcas||[]).length>0&&(
                  <div className="flex flex-col gap-1 mb-2">
                    {(encontrada.marcas||[]).map(function(m){
                      return <div key={m.id} className={"px-3 py-1.5 rounded-xl border font-bold text-sm "+marcaColor(m.color)}>{colorEmoji(m.color)+" "+m.motivo}</div>;
                    })}
                  </div>
                )}
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <p className="text-gray-800 font-black text-base">{encontrada.caravana}</p>
                    <p className="text-gray-500 text-xs">{encontrada.categoria}</p>
                    {yaReg&&<p className="text-amber-300 text-xs font-bold">⚠️ Ya registrada</p>}
                  </div>
                </div>
                {!yaReg&&(
                  <div className="flex flex-col gap-2">
                    {sesionActual.tipo==="tacto"&&(
                      <div className="flex gap-2">
                        {["Preñada","Vacía","Dudosa"].map(function(r){
                          var active=form.resultado===r;
                          var cls="flex-1 py-2 rounded-xl text-xs font-bold border "+(active?(r==="Preñada"?"bg-green-800 border-green-600 text-white":r==="Vacía"?"bg-red-800 border-red-600 text-white":"bg-amber-800 border-amber-600 text-white"):"bg-gray-50 border-gray-200 text-gray-500");
                          return <button key={r} onClick={function(){setF("resultado",r);}} className={cls}>{r}</button>;
                        })}
                      </div>
                    )}
                    {sesionActual.tipo==="parto"&&(
                      <div className="flex flex-col gap-2">
                        <div className="flex gap-2">
                          <button onClick={function(){setF("vivo",true);}} className={"flex-1 py-2 rounded-xl text-xs font-bold border "+(form.vivo?"bg-green-800 border-green-600 text-white":"bg-gray-50 border-gray-200 text-gray-500")}>Vivo</button>
                          <button onClick={function(){setF("vivo",false);}} className={"flex-1 py-2 rounded-xl text-xs font-bold border "+(!form.vivo?"bg-red-800 border-red-600 text-white":"bg-gray-50 border-gray-200 text-gray-500")}>Muerto</button>
                        </div>
                        {form.vivo&&(
                          <div className="grid grid-cols-2 gap-2">
                            <div className="flex flex-col gap-1">
                              <label className="text-[10px] text-gray-500 uppercase font-bold">Sexo ternero</label>
                              <select value={form.sexoTernero} onChange={function(e){setF("sexoTernero",e.target.value);}} style={{background:"#f9fafb"}} className=" border border-gray-200 rounded-xl px-2 py-2 text-gray-900 text-sm focus:outline-none">
                                <option>Macho</option><option>Hembra</option>
                              </select>
                            </div>
                            <Inp label="Caravana ternero" placeholder="Opcional" value={form.caravanaTernero} onChange={function(e){setF("caravanaTernero",e.target.value);}}/>
                          </div>
                        )}
                      </div>
                    )}
                    <Inp label="Observaciones" placeholder="Opcional" value={form.obs} onChange={function(e){setF("obs",e.target.value);}}/>
                    <button onClick={registrar} style={{boxShadow:"0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.08)"}} className="w-full bg-rose-500 text-white font-black py-3 rounded-xl text-lg border border-rose-400">✓ REGISTRAR</button>
                  </div>
                )}
              </div>
            )}
            {encontrada==="notfound"&&<p className="mt-2 text-amber-400 text-sm font-bold">{"⚠️ "+busq.trim().toUpperCase()+" — no encontrada"}</p>}
          </div>
          <div className="px-4 pb-4">
            <p className="text-[10px] text-gray-400 uppercase tracking-wider font-bold mb-2">{log.length+" registros"}</p>
            {log.map(function(r,i){
              return(
                <div key={r.id} className={"flex items-center justify-between rounded-xl px-3 py-2.5 mb-1.5 border "+(i===0?"bg-emerald-50 border-rose-300":"bg-gray-50 border-gray-200")}>
                  <div>
                    <p className="text-gray-900 font-bold text-base">{r.caravana}</p>
                    <p className="text-gray-500 text-xs">{r.categoria}</p>
                  </div>
                  <div className="text-right">
                    {r.resultado&&<p className={"text-sm font-bold "+(r.resultado==="Preñada"?"text-green-300":r.resultado==="Vacía"?"text-red-300":"text-amber-300")}>{r.resultado}</p>}
                    {r.tipo&&<p className="text-pink-600 text-sm font-bold">{r.tipo+(r.toro&&r.toro!=="__otro"?" · "+r.toro:"")}</p>}
                    {r.fechaPartoProbable&&<p className="text-amber-400 text-xs">{"Parto: "+fmtFecha(r.fechaPartoProbable)}</p>}
                    {r.vivo!==undefined&&<p className={"text-sm font-bold "+(r.vivo?"text-green-300":"text-red-300")}>{r.vivo?"Vivo":"Muerto"}{r.caravanaTernero?" · "+r.caravanaTernero:""}</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // ── RESUMEN SESIÓN ──
  if(modo==="resumen"){
    var tipoLbl=sesionActual.tipo==="tacto"?"Tacto":sesionActual.tipo==="servicio"?"Servicio":"Partos";
    var totalRegs=log.length;
    // Stats según tipo
    var prenadas=log.filter(function(r){return r.resultado==="Preñada";}).length;
    var vacias=log.filter(function(r){return r.resultado==="Vacía";}).length;
    var dudosas=log.filter(function(r){return r.resultado==="Dudosa";}).length;
    var vivos=log.filter(function(r){return r.vivo===true;}).length;
    var muertos=log.filter(function(r){return r.vivo===false;}).length;
    var machos=log.filter(function(r){return r.sexoTernero==="Macho";}).length;
    var hembrasT=log.filter(function(r){return r.sexoTernero==="Hembra";}).length;
    var natural=log.filter(function(r){return r.tipo==="Natural";}).length;
    var ia=log.filter(function(r){return r.tipo==="IA";}).length;
    // Faltantes (solo para sesiones activas, no soloVer)
    var totalHembras=hembras.length;
    var caravanasRegs=log.map(function(r){return r.caravana;});
    var faltantes=hembras.filter(function(h){return caravanasRegs.indexOf(h.caravana)===-1;});

    return(
      <Modal title={"📋 "+tipoLbl+" · "+fmtFecha(sesionActual.fecha)} onClose={function(){if(sesionActual.soloVer){setSesionActual(null);setLog([]);}setModo("menu");}}>
        <div className="flex flex-col gap-3">
          {/* Stats principales - 2 columnas */}
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 text-center">
              <p className="text-[10px] text-gray-500 uppercase font-bold mb-0.5">🐄 Animales</p>
              <p className="text-2xl font-black text-gray-900">{totalRegs}</p>
            </div>
            {sesionActual.tipo==="tacto"&&(
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 text-center">
                <p className="text-[10px] text-gray-500 uppercase font-bold mb-0.5">✅ Preñadas</p>
                <p className="text-2xl font-black text-emerald-700">{prenadas}</p>
              </div>
            )}
            {sesionActual.tipo==="servicio"&&(
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 text-center">
                <p className="text-[10px] text-gray-500 uppercase font-bold mb-0.5">💉 Total servicios</p>
                <p className="text-2xl font-black text-gray-900">{totalRegs}</p>
              </div>
            )}
            {sesionActual.tipo==="parto"&&(
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 text-center">
                <p className="text-[10px] text-gray-500 uppercase font-bold mb-0.5">💚 Vivos</p>
                <p className="text-2xl font-black text-emerald-700">{vivos}</p>
              </div>
            )}
          </div>

          {/* Stats secundarios según tipo */}
          {sesionActual.tipo==="tacto"&&(
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 text-center">
                <p className="text-[10px] text-gray-500 uppercase font-bold mb-0.5">❌ Vacías</p>
                <p className="text-xl font-black text-red-600">{vacias}</p>
              </div>
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 text-center">
                <p className="text-[10px] text-gray-500 uppercase font-bold mb-0.5">❓ Dudosas</p>
                <p className="text-xl font-black text-amber-600">{dudosas}</p>
              </div>
            </div>
          )}
          {sesionActual.tipo==="servicio"&&(
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 text-center">
                <p className="text-[10px] text-gray-500 uppercase font-bold mb-0.5">🐂 Natural</p>
                <p className="text-xl font-black text-gray-900">{natural}</p>
              </div>
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 text-center">
                <p className="text-[10px] text-gray-500 uppercase font-bold mb-0.5">💉 IA</p>
                <p className="text-xl font-black text-gray-900">{ia}</p>
              </div>
            </div>
          )}
          {sesionActual.tipo==="parto"&&(
            <>
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 text-center">
                  <p className="text-[10px] text-gray-500 uppercase font-bold mb-0.5">💔 Muertos</p>
                  <p className="text-xl font-black text-red-600">{muertos}</p>
                </div>
                <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 text-center">
                  <p className="text-[10px] text-gray-500 uppercase font-bold mb-0.5">📊 Total</p>
                  <p className="text-xl font-black text-gray-900">{totalRegs}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-center">
                  <p className="text-[10px] text-blue-600 uppercase font-bold mb-0.5">♂ Machos</p>
                  <p className="text-xl font-black text-blue-700">{machos}</p>
                </div>
                <div className="bg-pink-50 border border-pink-200 rounded-xl p-3 text-center">
                  <p className="text-[10px] text-pink-600 uppercase font-bold mb-0.5">♀ Hembras</p>
                  <p className="text-xl font-black text-pink-700">{hembrasT}</p>
                </div>
              </div>
            </>
          )}

          {/* Banner faltantes (solo si no es soloVer y hay faltantes en tacto/servicio) */}
          {!sesionActual.soloVer&&sesionActual.tipo!=="parto"&&faltantes.length>0&&(
            <div className="bg-amber-50 border border-amber-300 rounded-xl px-3 py-2.5 flex items-center gap-2">
              <span className="text-2xl">⚠️</span>
              <div className="flex-1">
                <p className="text-amber-800 font-bold text-sm">{"Faltaron "+faltantes.length+" animal"+(faltantes.length>1?"es":"")+" por "+(sesionActual.tipo==="tacto"?"tactar":"servicio")}</p>
                <p className="text-amber-600 text-xs">{"de "+totalHembras+" totales en el lote"}</p>
              </div>
            </div>
          )}

          {/* Listado de registros */}
          <div className="flex flex-col gap-1.5 max-h-72 overflow-y-auto">
            {log.map(function(r){
              return(
                <div key={r.id} className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="text-gray-900 font-black text-sm">{r.caravana}</p>
                    <p className="text-gray-500 text-xs">{r.categoria||""}</p>
                  </div>
                  <div className="text-right ml-2">
                    {r.resultado&&<p className={"text-sm font-bold "+(r.resultado==="Preñada"?"text-emerald-700":r.resultado==="Vacía"?"text-red-600":"text-amber-700")}>{r.resultado}</p>}
                    {r.tipo&&<p className="text-gray-700 text-xs">{r.tipo+(r.toro&&r.toro!=="__otro"?" · "+r.toro:"")}</p>}
                    {r.fechaPartoProbable&&<p className="text-amber-700 text-[10px]">{"🐄 "+fmtFecha(r.fechaPartoProbable)}</p>}
                    {r.vivo!==undefined&&<p className={"text-sm font-bold "+(r.vivo?"text-emerald-700":"text-red-600")}>{r.vivo?"Vivo":"Muerto"}</p>}
                    {r.sexoTernero&&<p className={"text-xs font-bold "+(r.sexoTernero==="Macho"?"text-blue-700":"text-pink-700")}>{r.sexoTernero==="Macho"?"♂ Macho":"♀ Hembra"}</p>}
                    {r.obs&&<p className="text-gray-500 text-[10px] mt-0.5">{r.obs}</p>}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Exportar a Excel */}
          {log.length>0&&(
            <button onClick={function(){setExportRepro(exportDatosRepro(Object.assign({},sesionActual,{registros:log}),lote.nombre));}} className="w-full bg-gray-50 border border-gray-200 text-gray-700 font-bold py-2.5 rounded-xl text-sm">📊 Exportar a Excel</button>
          )}
          {exportRepro&&<ExportModal {...exportRepro} onClose={function(){setExportRepro(null);}}/>}
        </div>
      </Modal>
    );
  }
  return null;
}

// ── Toros Modal ───────────────────────────────────────────────────────────────
// ── Editar Animal Modal ────────────────────────────────────────────────────────
function EditarAnimalModal({animal,onClose,onGuardar}){
  var [f,setF]=useState({
    caravana:animal.caravana||"",
    sexo:animal.sexo||"",
    categoria:animal.categoria||"",
    raza:animal.raza||"",
    fechaNac:animal.fechaNac||"",
    obs:animal.obs||""
  });
  function set(k,v){setF(function(p){return Object.assign({},p,{[k]:v});});}
  function guardar(){
    if(!f.caravana.trim()){alert("La caravana es obligatoria");return;}
    if(!f.sexo){alert("Falta el sexo");return;}
    if(!f.categoria){alert("Falta la categoría");return;}
    onGuardar({
      caravana:f.caravana.trim().toUpperCase(),
      sexo:f.sexo,
      categoria:f.categoria,
      raza:f.raza,
      fechaNac:f.fechaNac,
      obs:f.obs
    });
  }
  return(
    <Modal title={"✏️ Editar "+animal.caravana} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <Inp label="Caravana *" value={f.caravana} onChange={function(e){set("caravana",e.target.value);}}/>
        <div className="grid grid-cols-2 gap-2">
          <Sel label="Sexo *" options={["Macho","Hembra"]} value={f.sexo} onChange={function(e){set("sexo",e.target.value);}}/>
          <Sel label="Categoría *" options={CATEGORIAS} value={f.categoria} onChange={function(e){set("categoria",e.target.value);}}/>
        </div>
        <Sel label="Raza" options={RAZAS} value={f.raza} onChange={function(e){set("raza",e.target.value);}}/>
        <FechaSelector label="Fecha de nacimiento" value={f.fechaNac} onChange={function(v){set("fechaNac",v);}} minAnio={new Date().getFullYear()-25}/>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-green-600 font-bold uppercase">Observaciones</label>
          <textarea rows={2} value={f.obs} onChange={function(e){set("obs",e.target.value);}}
            className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-gray-800 text-sm focus:outline-none focus:border-green-400 resize-none"/>
        </div>
        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-gray-700 text-sm font-bold">Cancelar</button>
          <button onClick={guardar} style={{boxShadow:"0 1px 3px rgba(0,0,0,0.12)"}} className="flex-1 bg-emerald-300 text-white font-black py-2.5 rounded-xl text-sm border border-emerald-300">Guardar</button>
        </div>
      </div>
    </Modal>
  );
}

// ── Vender Animal Modal ────────────────────────────────────────────────────────
function VenderAnimalModal({animal,loteNombre,onClose,onVender}){
  var ultPeso=animal.pesajes&&animal.pesajes.length>0?[...animal.pesajes].sort(function(a,b){return b.fecha.localeCompare(a.fecha);})[0]:null;
  var [form,setForm]=useState({
    fecha:hoy(),
    peso:ultPeso?String(ultPeso.peso):"",
    precioKg:"",
    precioTotal:"",
    comprador:"",
    obs:""
  });
  function setF(k,v){setForm(function(p){return Object.assign({},p,{[k]:v});});}
  // Auto calcular precio total si pone precio/kg + peso, o viceversa
  function onChangePrecioKg(v){
    setF("precioKg",v);
    if(v&&form.peso){
      var total=(parseFloat(v)*parseFloat(form.peso)).toFixed(2);
      setF("precioTotal",total);
    }
  }
  function onChangePeso(v){
    setF("peso",v);
    if(v&&form.precioKg){
      var total=(parseFloat(v)*parseFloat(form.precioKg)).toFixed(2);
      setF("precioTotal",total);
    }
  }
  function confirmar(){
    if(!form.fecha){alert("Poné la fecha");return;}
    onVender({
      fecha:form.fecha,
      peso:form.peso?parseFloat(form.peso):null,
      precioKg:form.precioKg?parseFloat(form.precioKg):null,
      precioTotal:form.precioTotal?parseFloat(form.precioTotal):null,
      comprador:form.comprador.trim(),
      obs:form.obs.trim(),
      loteOrigen:loteNombre
    });
  }
  return(
    <Modal title={"💰 Vender "+animal.caravana} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3">
          <p className="text-xs text-emerald-700">Este animal va a salir del lote <b>{loteNombre}</b> y quedar en el registro de vendidos. Vas a poder ver toda su info ahí.</p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Inp label="Fecha venta" type="date" value={form.fecha} onChange={function(e){setF("fecha",e.target.value);}}/>
          <Inp label="Peso (kg)" type="number" placeholder="0" value={form.peso} onChange={function(e){onChangePeso(e.target.value);}}/>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Inp label="$/kg" type="number" placeholder="0" value={form.precioKg} onChange={function(e){onChangePrecioKg(e.target.value);}}/>
          <Inp label="Total ($)" type="number" placeholder="0" value={form.precioTotal} onChange={function(e){setF("precioTotal",e.target.value);}}/>
        </div>
        <Inp label="Comprador" placeholder="Opcional" value={form.comprador} onChange={function(e){setF("comprador",e.target.value);}}/>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-green-600 font-bold uppercase">Observaciones</label>
          <textarea rows={2} value={form.obs} onChange={function(e){setF("obs",e.target.value);}} placeholder="Notas..."
            className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-gray-800 text-sm focus:outline-none focus:border-green-400 resize-none"/>
        </div>
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-gray-700 text-sm font-bold">Cancelar</button>
          <button onClick={confirmar} style={{boxShadow:"0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.08)"}} className="flex-1 bg-emerald-600 text-white font-black py-2.5 rounded-xl text-sm border border-emerald-500">✓ Confirmar venta</button>
        </div>
      </div>
    </Modal>
  );
}

// ── Vendidos Modal ─────────────────────────────────────────────────────────────
function VendidosModal({est,onClose,onEliminar}){
  var [ask,confirmDialog]=useConfirm();
  var [busq,setBusq]=useState("");
  var [anioFiltro,setAnioFiltro]=useState("");
  var [detalle,setDetalle]=useState(null);
  var vendidos=est.vendidos||[];
  var vendidosOrdenados=[...vendidos].sort(function(a,b){return (b.venta.fecha||"").localeCompare(a.venta.fecha||"");});
  var aniosDisp=aniosDe(vendidos,function(v){return v.venta.fecha;});
  var filtrados=vendidosOrdenados.filter(function(v){
    if(anioFiltro&&(!v.venta.fecha||v.venta.fecha.substring(0,4)!==anioFiltro))return false;
    var q=busq.trim().toUpperCase();
    if(!q)return true;
    return v.caravana.toUpperCase().indexOf(q)>=0||(v.venta.comprador||"").toUpperCase().indexOf(q)>=0;
  });
  // Total facturado: respeta el filtro de año
  var vendidosParaTotal=anioFiltro?vendidos.filter(function(v){return v.venta.fecha&&v.venta.fecha.substring(0,4)===anioFiltro;}):vendidos;
  var totalGanado=vendidosParaTotal.reduce(function(s,v){return s+(v.venta.precioTotal||0);},0);
  var totalAnimales=vendidosParaTotal.length;
  var totalAnimGral=vendidos.length;

  if(detalle){
    var a=detalle;
    var pesajes=a.pesajes||[];
    var pesajesOrd=[...pesajes].sort(function(x,y){return x.fecha.localeCompare(y.fecha);});
    var primerPeso=pesajesOrd.length>0?pesajesOrd[0]:null;
    var ultimoPeso=pesajesOrd.length>0?pesajesOrd[pesajesOrd.length-1]:null;
    var kgGanTotal=primerPeso&&ultimoPeso?(ultimoPeso.peso-primerPeso.peso):null;

    // Agrupar pesajes por lote (usando historial si existe)
    var historial=a.historialLotes||[];
    function loteEnFecha(fecha){
      if(historial.length===0)return a.venta.loteOrigen||"—";
      var vigente=historial[0].lote;
      for(var i=0;i<historial.length;i++){
        if(historial[i].fecha<=fecha)vigente=historial[i].lote;
        else break;
      }
      return vigente;
    }
    var porLote={};
    pesajesOrd.forEach(function(p){
      var lote=loteEnFecha(p.fecha);
      if(!porLote[lote])porLote[lote]={pesajes:[]};
      porLote[lote].pesajes.push(p);
    });
    var lotesOrd=Object.keys(porLote);

    return(
      <Modal title={"💰 "+a.caravana} onClose={function(){setDetalle(null);}}>
        <div className="flex flex-col gap-3">
          <button onClick={function(){setDetalle(null);}} className="text-gray-700 text-sm font-bold text-left">← Volver</button>

          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 flex flex-col gap-1">
            <p className="text-xs text-emerald-600 uppercase font-bold">Datos del animal</p>
            <p className="text-gray-900 text-sm"><b>Caravana:</b> {a.caravana}</p>
            {a.sexo&&<p className="text-gray-900 text-sm"><b>Sexo:</b> {a.sexo}</p>}
            {a.categoria&&<p className="text-gray-900 text-sm"><b>Categoría:</b> {a.categoria}</p>}
            {a.raza&&<p className="text-gray-900 text-sm"><b>Raza:</b> {a.raza}</p>}
            {a.fechaNac&&<p className="text-gray-900 text-sm"><b>Nac:</b> {fmtFecha(a.fechaNac)}</p>}
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex flex-col gap-1">
            <p className="text-xs text-amber-700 uppercase font-bold">Datos de la venta</p>
            <p className="text-gray-900 text-sm"><b>Fecha:</b> {fmtFecha(a.venta.fecha)}</p>
            {a.venta.peso&&<p className="text-gray-900 text-sm"><b>Peso final:</b> {a.venta.peso+" kg"}</p>}
            {a.venta.precioKg&&<p className="text-gray-900 text-sm"><b>$/kg:</b> {"$"+a.venta.precioKg.toLocaleString("es-AR")}</p>}
            {a.venta.precioTotal&&<p className="text-amber-800 font-black text-lg">{"Total: $"+a.venta.precioTotal.toLocaleString("es-AR")}</p>}
            {a.venta.comprador&&<p className="text-gray-900 text-sm"><b>Comprador:</b> {a.venta.comprador}</p>}
            {a.venta.obs&&<p className="text-gray-900 text-sm mt-1">{a.venta.obs}</p>}
          </div>

          {kgGanTotal!==null&&(
            <div className="bg-sky-50 border border-sky-200 rounded-xl p-3">
              <p className="text-xs text-sky-700 uppercase font-bold">Ganancia total</p>
              <p className={"font-black text-lg "+(kgGanTotal>=0?"text-emerald-700":"text-red-600")}>{(kgGanTotal>=0?"+":"")+kgGanTotal.toFixed(1)+" kg"}</p>
              {primerPeso&&ultimoPeso&&<p className="text-xs text-sky-600">{"De "+primerPeso.peso+"kg ("+fmtFecha(primerPeso.fecha)+") a "+ultimoPeso.peso+"kg ("+fmtFecha(ultimoPeso.fecha)+")"}</p>}
            </div>
          )}

          {lotesOrd.length>0&&(
            <div className="flex flex-col gap-2">
              <p className="text-xs text-gray-600 uppercase font-bold">Detalle por lote</p>
              {lotesOrd.map(function(lot){
                var ps=porLote[lot].pesajes;
                var ini=ps[0];
                var fin=ps[ps.length-1];
                var gan=ps.length>1?(fin.peso-ini.peso):null;
                return(
                  <div key={lot} className="bg-gray-50 border border-gray-200 rounded-xl p-3">
                    <p className="text-gray-900 font-bold text-sm">{lot}</p>
                    <p className="text-xs text-gray-500">{ps.length+" pesaje"+(ps.length>1?"s":"")+" · "+fmtFecha(ini.fecha)+(ps.length>1?" a "+fmtFecha(fin.fecha):"")}</p>
                    {gan!==null&&<p className={"text-sm font-bold "+(gan>=0?"text-emerald-600":"text-red-500")}>{(gan>=0?"+":"")+gan.toFixed(1)+" kg"}</p>}
                  </div>
                );
              })}
            </div>
          )}

          {pesajesOrd.length>0&&(
            <div className="flex flex-col gap-2">
              <p className="text-xs text-gray-600 uppercase font-bold">Todos los pesajes</p>
              {pesajesOrd.map(function(p,i){
                var prev=i>0?pesajesOrd[i-1]:null;
                var dif=prev?(p.peso-prev.peso).toFixed(1):null;
                return(
                  <div key={p.id||i} className="bg-gray-50 border border-gray-100 rounded-xl px-3 py-2 flex items-center justify-between">
                    <div>
                      <p className="text-gray-900 text-sm font-bold">{p.peso+" kg"}</p>
                      <p className="text-xs text-gray-500">{fmtFecha(p.fecha)}</p>
                    </div>
                    {dif!==null&&<span className={"text-xs font-bold "+(parseFloat(dif)>=0?"text-emerald-600":"text-red-500")}>{(parseFloat(dif)>=0?"+":"")+dif+" kg"}</span>}
                  </div>
                );
              })}
            </div>
          )}

          <button onClick={function(){ask("¿Eliminar registro de venta? Esta acción no se puede deshacer.",function(){onEliminar(a.id);setDetalle(null);});}} className="w-full py-2.5 rounded-xl border border-red-300 text-red-600 text-sm font-bold">🗑 Eliminar registro</button>
          {confirmDialog}
        </div>
      </Modal>
    );
  }

  return(
    <Modal title={"💰 Vendidos"+(totalAnimGral>0?" ("+totalAnimGral+")":"")} onClose={onClose}>
      <div className="flex flex-col gap-3">
        {totalAnimGral>0&&(
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-center">
            <p className="text-xs text-emerald-700 uppercase font-bold">{"Total facturado"+(anioFiltro?" "+anioFiltro:"")}</p>
            <p className="text-2xl font-black text-emerald-800">{"$"+totalGanado.toLocaleString("es-AR")}</p>
            <p className="text-xs text-emerald-600">{totalAnimales+" animal"+(totalAnimales>1?"es":"")+" vendido"+(totalAnimales>1?"s":"")}</p>
          </div>
        )}

        {totalAnimGral>0&&aniosDisp.length>0&&(
          <FiltroAnio anios={aniosDisp} valor={anioFiltro} onChange={function(e){setAnioFiltro(e.target.value);}} total={totalAnimGral} filtrados={totalAnimales}/>
        )}

        {totalAnimGral>0&&(
          <input value={busq} onChange={function(e){setBusq(e.target.value);}} placeholder="🔍 Buscar caravana o comprador..."
            style={{background:"#f9fafb"}} className="border border-gray-200 rounded-xl px-3 py-2.5 text-gray-900 text-sm focus:outline-none w-full"/>
        )}

        {totalAnimGral===0&&(
          <div className="text-center py-12">
            <p className="text-5xl mb-3">💰</p>
            <p className="text-gray-800 font-bold text-base mb-1">Sin ventas registradas</p>
            <p className="text-gray-500 text-xs mb-1">Cuando vendas un animal, va a aparecer acá</p>
            <p className="text-gray-400 text-xs">Para vender: entrá al animal → tocá <b>"💰 Vender"</b></p>
          </div>
        )}

        {filtrados.map(function(v){
          return(
            <button key={v.id} onClick={function(){setDetalle(v);}} className="w-full text-left bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 flex items-center justify-between">
              <div className="flex-1">
                <p className="text-gray-900 font-black text-sm">{v.caravana}</p>
                <div className="flex gap-2 mt-0.5">
                  {v.sexo&&<span className={"text-[10px] px-1.5 py-0.5 rounded-full font-bold "+(v.sexo==="Macho"?"bg-blue-50 text-blue-700":"bg-pink-50 text-pink-700")}>{v.sexo}</span>}
                  {v.categoria&&<span className="text-[10px] text-gray-600">{v.categoria}</span>}
                </div>
                <p className="text-xs text-gray-500 mt-1">{fmtFecha(v.venta.fecha)+(v.venta.comprador?" · "+v.venta.comprador:"")}</p>
              </div>
              <div className="text-right">
                {v.venta.precioTotal?<p className="text-emerald-700 font-black text-sm">{"$"+v.venta.precioTotal.toLocaleString("es-AR")}</p>:<p className="text-gray-400 text-xs">Sin precio</p>}
                {v.venta.peso&&<p className="text-xs text-gray-500">{v.venta.peso+" kg"}</p>}
              </div>
            </button>
          );
        })}
      </div>
    </Modal>
  );
}

function TorosModal({est,onClose,onUpdate}){
  var [ask,confirmDialog]=useConfirm();
  var [form,setForm]=useState({caravana:"",raza:"",fechaNac:"",propietario:"",cabana:"",fechaCompra:"",precioCompra:"",pesoActual:"",obs:""});
  var [editandoId,setEditandoId]=useState(null);
  var [verToro,setVerToro]=useState(null);
  var [showForm,setShowForm]=useState(false);
  var toros=est.toros||[];
  function setF(k,v){setForm(function(p){return Object.assign({},p,{[k]:v});});}
  function reset(){setForm({caravana:"",raza:"",fechaNac:"",propietario:"",cabana:"",fechaCompra:"",precioCompra:"",pesoActual:"",obs:""});setEditandoId(null);setShowForm(false);}
  function guardar(){
    if(!form.caravana.trim())return;
    var datos={
      caravana:form.caravana.trim().toUpperCase(),
      raza:form.raza,
      fechaNac:form.fechaNac,
      propietario:form.propietario.trim(),
      cabana:form.cabana.trim(),
      fechaCompra:form.fechaCompra,
      precioCompra:form.precioCompra?parseFloat(form.precioCompra):null,
      pesoActual:form.pesoActual?parseFloat(form.pesoActual):null,
      obs:form.obs
    };
    if(editandoId){
      onUpdate(toros.map(function(t){return t.id===editandoId?Object.assign({},t,datos):t;}));
    }else{
      onUpdate([...toros,Object.assign({id:Date.now()},datos)]);
    }
    reset();
  }
  function editar(t){
    setForm({
      caravana:t.caravana||"",
      raza:t.raza||"",
      fechaNac:t.fechaNac||"",
      propietario:t.propietario||"",
      cabana:t.cabana||"",
      fechaCompra:t.fechaCompra||"",
      precioCompra:t.precioCompra?String(t.precioCompra):"",
      pesoActual:t.pesoActual?String(t.pesoActual):"",
      obs:t.obs||""
    });
    setEditandoId(t.id);
    setVerToro(null);
    setShowForm(true);
  }

  // Vista detalle de un toro
  if(verToro){
    var t=verToro;
    return(
      <Modal title={"🐂 "+t.caravana} onClose={function(){setVerToro(null);}}>
        <div className="flex flex-col gap-3">
          <button onClick={function(){setVerToro(null);}} className="text-gray-700 text-sm font-bold text-left">← Volver</button>

          <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 flex flex-col gap-1.5">
            <p className="text-xs text-gray-500 uppercase font-bold mb-1">Datos generales</p>
            <p className="text-gray-900 text-sm"><b>Caravana:</b> {t.caravana}</p>
            {t.raza&&<p className="text-gray-900 text-sm"><b>Raza:</b> {t.raza}</p>}
            {t.fechaNac&&<p className="text-gray-900 text-sm"><b>F. Nacimiento:</b> {fmtFecha(t.fechaNac)+(calcEdad(t.fechaNac)?" ("+calcEdad(t.fechaNac)+")":"")}</p>}
            {t.cabana&&<p className="text-gray-900 text-sm"><b>Cabaña/Línea:</b> {t.cabana}</p>}
            {t.propietario&&<p className="text-gray-900 text-sm"><b>Propietario:</b> {t.propietario}</p>}
            {t.pesoActual&&<p className="text-gray-900 text-sm"><b>Peso actual:</b> {t.pesoActual+" kg"}</p>}
          </div>

          {(t.fechaCompra||t.precioCompra)&&(
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 flex flex-col gap-1.5">
              <p className="text-xs text-emerald-700 uppercase font-bold mb-1">Compra</p>
              {t.fechaCompra&&<p className="text-gray-900 text-sm"><b>Fecha:</b> {fmtFecha(t.fechaCompra)}</p>}
              {t.precioCompra&&<p className="text-gray-900 text-sm"><b>Precio:</b> {"$"+t.precioCompra.toLocaleString("es-AR")}</p>}
            </div>
          )}

          {t.obs&&(
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-3">
              <p className="text-xs text-gray-500 uppercase font-bold mb-1">Observaciones</p>
              <p className="text-gray-900 text-sm">{t.obs}</p>
            </div>
          )}

          <div className="flex gap-2">
            <button onClick={function(){editar(t);}} className="flex-1 py-2.5 rounded-xl border border-sky-300 bg-sky-50 text-sky-700 text-sm font-bold">✏️ Editar</button>
            <button onClick={function(){ask("¿Eliminar toro?",function(){onUpdate(toros.filter(function(x){return x.id!==t.id;}));setVerToro(null);});}} className="flex-1 py-2.5 rounded-xl border border-red-300 bg-red-50 text-red-700 text-sm font-bold">🗑 Eliminar</button>
          </div>
          {confirmDialog}
        </div>
      </Modal>
    );
  }

  // Vista formulario (agregar o editar)
  if(showForm){
    return(
      <Modal title={editandoId?"✏️ Editar toro":"+ Agregar toro"} onClose={reset}>
        <div className="flex flex-col gap-3">
          <button onClick={reset} className="text-gray-700 text-sm font-bold text-left">← Volver a la lista</button>
          <Inp label="Caravana *" placeholder="N° caravana" value={form.caravana} onChange={function(e){setF("caravana",e.target.value);}}/>
          <Sel label="Raza" options={RAZAS} value={form.raza} onChange={function(e){setF("raza",e.target.value);}}/>
          <FechaSelector label="Fecha nacimiento" value={form.fechaNac} onChange={function(v){setF("fechaNac",v);}} minAnio={new Date().getFullYear()-25}/>
          <div className="grid grid-cols-2 gap-2">
            <Inp label="Cabaña/Línea" placeholder="Opcional" value={form.cabana} onChange={function(e){setF("cabana",e.target.value);}}/>
            <Inp label="Propietario" placeholder="Opcional" value={form.propietario} onChange={function(e){setF("propietario",e.target.value);}}/>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Inp label="Fecha compra" type="date" value={form.fechaCompra} onChange={function(e){setF("fechaCompra",e.target.value);}}/>
            <Inp label="Precio compra ($)" type="number" placeholder="0" value={form.precioCompra} onChange={function(e){setF("precioCompra",e.target.value);}}/>
          </div>
          <Inp label="Peso actual (kg)" type="number" placeholder="0" value={form.pesoActual} onChange={function(e){setF("pesoActual",e.target.value);}}/>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-green-600 font-bold uppercase">Observaciones</label>
            <textarea rows={2} value={form.obs} onChange={function(e){setF("obs",e.target.value);}} placeholder="Características, problemas, etc..."
              className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-gray-800 text-sm focus:outline-none focus:border-green-400 resize-none"/>
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={reset} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-gray-700 text-sm font-bold">Cancelar</button>
            <button onClick={guardar} style={{boxShadow:"0 1px 2px rgba(0,0,0,0.1)"}} className="flex-1 bg-emerald-300 text-white font-black py-2.5 rounded-xl text-sm border border-emerald-300">{editandoId?"Guardar cambios":"Guardar Toro"}</button>
          </div>
        </div>
      </Modal>
    );
  }

  // Vista lista (por defecto)
  return(
    <Modal title={"🐂 Toros"+(toros.length>0?" ("+toros.length+")":"")} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <button onClick={function(){setShowForm(true);}} style={{boxShadow:"0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.08)"}} className="w-full bg-emerald-300 text-white font-black py-3 rounded-xl text-sm border border-emerald-300">+ Agregar toro</button>

        {toros.length===0&&(
          <div className="text-center py-8">
            <p className="text-5xl mb-2">🐂</p>
            <p className="text-gray-700 font-bold text-sm mb-1">Aún no hay toros</p>
            <p className="text-gray-400 text-xs">Cargá tus toros con todos sus datos para llevar el registro completo</p>
          </div>
        )}
        {toros.map(function(t){
          return(
            <button key={t.id} onClick={function(){setVerToro(t);}} className="text-left bg-gray-50 border border-gray-100 rounded-xl px-4 py-3 flex items-start justify-between">
              <div className="flex-1">
                <p className="text-gray-800 font-black text-base">{t.caravana}</p>
                <div className="flex gap-2 flex-wrap mt-0.5">
                  {t.raza&&<span className="text-[10px] bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-full">{t.raza}</span>}
                  {t.fechaNac&&<span className="text-[10px] text-gray-500">{calcEdad(t.fechaNac)||""}</span>}
                  {t.cabana&&<span className="text-[10px] text-gray-500">· {t.cabana}</span>}
                </div>
                {t.pesoActual&&<p className="text-emerald-700 text-xs font-bold mt-0.5">{t.pesoActual+" kg"}</p>}
              </div>
              <span className="text-gray-400 text-xl ml-2">›</span>
            </button>
          );
        })}
        {confirmDialog}
      </div>
    </Modal>
  );
}

// ── Cuaderno Modal ────────────────────────────────────────────────────────────
function CuadernoModal({notas,onClose,onSave}){
  var [texto,setTexto]=useState(notas||"");
  return(
    <Modal title="📓 Anotaciones" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <textarea rows={12} value={texto} onChange={function(e){setTexto(e.target.value);}}
          placeholder="Anotá lo que necesites: actividades, observaciones, recordatorios..."
          className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-3 text-gray-900 text-sm focus:outline-none resize-none placeholder-gray-400"/>
        <button onClick={function(){onSave(texto);onClose();}} style={{boxShadow:"0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.08)"}} className="w-full bg-emerald-600 text-white font-black py-3 rounded-xl border border-emerald-500">Guardar</button>
      </div>
    </Modal>
  );
}

// ── Alertas Modal ─────────────────────────────────────────────────────────────
function AlertasModal({alertas,onClose,onSave,nombreEst,lotes}){
  var [ask,confirmDialog]=useConfirm();
  var [form,setForm]=useState({titulo:"",tipo:"",fechaHora:"",loteId:"",obs:""});
  var [showForm,setShowForm]=useState(false);
  function setF(k,v){setForm(function(p){return Object.assign({},p,{[k]:v});});}
  function guardar(){
    if(!form.titulo||!form.fechaHora)return;
    onSave([...alertas,{id:Date.now(),...form,pasada:false}]);
    setForm({titulo:"",tipo:"",fechaHora:"",loteId:"",obs:""});
    setShowForm(false);
  }
  function colorEst(estado){
    if(estado==="pasada")return "bg-gray-700 border-gray-500 text-gray-300";
    if(estado==="urgente")return "bg-red-900 border-red-600 text-red-200";
    if(estado==="pronto")return "bg-amber-900 border-amber-600 text-amber-200";
    return "bg-emerald-100 border-emerald-300 text-emerald-700";
  }
  var sorted=[...alertas].sort(function(a,b){return new Date(a.fechaHora)-new Date(b.fechaHora);});
  return(
    <Modal title={"🔔 Alertas · "+nombreEst} onClose={onClose}>
      <div className="flex flex-col gap-3">
        {!showForm?(
          <button onClick={function(){setShowForm(true);}} style={{boxShadow:"0 1px 2px rgba(0,0,0,0.1)"}} className="w-full bg-emerald-600 text-white font-bold py-2.5 rounded-xl border border-emerald-500">+ Nueva alerta</button>
        ):(
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 flex flex-col gap-2">
            <Inp label="Título *" value={form.titulo} onChange={function(e){setF("titulo",e.target.value);}} placeholder="Ej: Vacunar terneros"/>
            <div className="grid grid-cols-2 gap-2">
              <Sel label="Tipo" options={TIPOS_ALERTA} value={form.tipo} onChange={function(e){setF("tipo",e.target.value);}}/>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] text-green-600 font-bold uppercase">Lote (opcional)</label>
                <select value={form.loteId} onChange={function(e){setF("loteId",e.target.value);}} className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-gray-800 text-sm focus:outline-none focus:border-green-400">
                  <option value="">— General —</option>
                  {(lotes||[]).map(function(l){return <option key={l.id} value={l.id}>{l.nombre}</option>;})}
                </select>
              </div>
            </div>
            <Inp label="Fecha y hora *" type="datetime-local" value={form.fechaHora} onChange={function(e){setF("fechaHora",e.target.value);}}/>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-green-600 font-bold uppercase">Observaciones</label>
              <textarea rows={2} value={form.obs} onChange={function(e){setF("obs",e.target.value);}}
                className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-gray-800 text-sm focus:outline-none focus:border-green-400 resize-none"/>
            </div>
            <div className="flex gap-2">
              <button onClick={function(){setShowForm(false);}} className="flex-1 py-2 rounded-xl border border-gray-200 text-gray-500 text-sm">Cancelar</button>
              <button onClick={guardar} className="flex-1 py-2 rounded-xl bg-emerald-600 text-gray-900 font-bold text-sm border border-emerald-400">Guardar</button>
            </div>
          </div>
        )}
        {sorted.length===0&&(
          <div className="text-center py-8">
            <p className="text-5xl mb-2">🔔</p>
            <p className="text-gray-700 font-bold text-sm mb-1">Sin alertas todavía</p>
            <p className="text-gray-400 text-xs">Creá una para acordarte de tactos, vacunas, partos, etc.</p>
          </div>
        )}
        {sorted.map(function(a){
          var est=estadoAlerta(a.fechaHora,a.pasada);
          var loteNombre=a.loteId?(lotes||[]).find(function(l){return l.id===parseInt(a.loteId);})||null:null;
          return(
            <div key={a.id} className={"rounded-xl px-4 py-3 border "+colorEst(est)}>
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <p className="font-bold text-base">{a.titulo}</p>
                  {a.tipo&&<p className="text-xs opacity-70">{a.tipo}</p>}
                  <p className="text-xs opacity-70 mt-0.5">{new Date(a.fechaHora).toLocaleString("es-AR")}</p>
                  {loteNombre&&<p className="text-xs opacity-70">{"Lote: "+loteNombre.nombre}</p>}
                  {a.obs&&<p className="text-xs mt-1 opacity-80">{a.obs}</p>}
                </div>
                <div className="flex flex-col gap-1 ml-2">
                  {!a.pasada&&<button onClick={function(){onSave(alertas.map(function(x){return x.id===a.id?Object.assign({},x,{pasada:true}):x;}));}} className="text-xs opacity-60 hover:opacity-100">✓</button>}
                  <button onClick={function(){ask("¿Eliminar alerta?",function(){onSave(alertas.filter(function(x){return x.id!==a.id;}));});}} className="text-red-400 text-lg">✕</button>
                </div>
              </div>
            </div>
          );
        })}
        {confirmDialog}
      </div>
    </Modal>
  );
}

// ── Agro Vista Lote ───────────────────────────────────────────────────────────
function AgroVistaLote({agro,onUpdate,loteNombre}){
  var [tab,setTab]=useState("potreros");
  var [potreroActivo,setPotreroActivo]=useState(null);
  var [busqPot,setBusqPot]=useState("");
  var [mostrarNuevo,setMostrarNuevo]=useState(false);
  var [formPot,setFormPot]=useState({nombre:"",hectareas:"",desc:""});
  var [formAct,setFormAct]=useState({fecha:hoy(),actividad:"",cultivo:"",obs:"",kgCosecha:"",potrero:""});
  var [formGasto,setFormGasto]=useState({fecha:hoy(),concepto:"",monto:"",potrero:""});
  var [ask,confirmDialog]=useConfirm();
  var setPot=function(k,v){setFormPot(function(p){return Object.assign({},p,{[k]:v});});};
  var setA=function(k,v){setFormAct(function(p){return Object.assign({},p,{[k]:v});});};
  var setG=function(k,v){setFormGasto(function(p){return Object.assign({},p,{[k]:v});});};
  var [anioActi,setAnioActi]=useState("");
  var [anioGasto,setAnioGasto]=useState("");
  var [tipoFiltro,setTipoFiltro]=useState("");
  var potreros=agro.potreros||[];
  var registros=agro.registros||[];
  var gastos=agro.gastos||[];

  function guardarPotrero(){
    if(!formPot.nombre.trim())return;
    onUpdate(Object.assign({},agro,{potreros:[...potreros,{id:Date.now(),nombre:formPot.nombre.trim(),hectareas:parseFloat(formPot.hectareas)||0,desc:formPot.desc}]}));
    setFormPot({nombre:"",hectareas:"",desc:""});setMostrarNuevo(false);
  }

  function tabBtn(t,label){
    return(
      <button key={t} onClick={function(){setTab(t);}
      } className={"px-3 py-2 rounded-xl text-xs font-black border-2 "+(tab===t?"bg-amber-400 border-amber-400 text-amber-900":"bg-white border-amber-200 text-amber-500")}>
        {label}
      </button>
    );
  }

  return(
    <div className="flex flex-col gap-4">
      <div className="flex gap-1 flex-wrap">
        {tabBtn("potreros","🗺️ Potreros")}
        {tabBtn("actividad","📋 Actividades")}
        {tabBtn("gastos","💰 Gastos")}
      </div>

      {tab==="potreros"&&(
        <div className="flex flex-col gap-3">
          {!potreroActivo&&(
            <div className="flex flex-col gap-3">
              <input value={busqPot} onChange={function(e){setBusqPot(e.target.value);}} placeholder="🔍 Buscar potrero..."
                style={{background:"#f9fafb"}} className=" border border-gray-200 rounded-xl px-3 py-2.5 text-gray-900 text-sm focus:outline-none w-full"/>
              {mostrarNuevo?(
                <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 flex flex-col gap-3">
                  <Inp label="Nombre" placeholder="Ej: Potrero Norte" value={formPot.nombre} onChange={function(e){setPot("nombre",e.target.value);}}/>
                  <Inp label="Hectáreas" type="number" placeholder="0" value={formPot.hectareas} onChange={function(e){setPot("hectareas",e.target.value);}}/>
                  <div className="flex gap-2">
                    <button onClick={function(){setMostrarNuevo(false);}} className="flex-1 py-2 rounded-xl border border-gray-200 text-gray-700 text-sm">Cancelar</button>
                    <button onClick={guardarPotrero} className="flex-1 py-2 rounded-xl bg-amber-400 text-amber-900 font-bold text-sm border border-amber-400">Guardar</button>
                  </div>
                </div>
              ):(
                <button onClick={function(){setMostrarNuevo(true);}} style={{boxShadow:"0 1px 2px rgba(0,0,0,0.1)"}} className="w-full bg-amber-400 text-amber-900 font-bold py-2.5 rounded-xl text-sm border border-amber-400">＋ Nuevo Potrero</button>
              )}
              {potreros.filter(function(p){return p.nombre.toLowerCase().includes(busqPot.toLowerCase());}).map(function(p){
                var acts=registros.filter(function(r){return r.potrero===p.nombre;});
                return(
                  <button key={p.id} onClick={function(){setPotreroActivo(p);}} className="w-full text-left bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-amber-900 font-black text-base">{p.nombre}</p>
                        <div className="flex gap-3 mt-1">
                          {p.hectareas>0&&<span className="text-[10px] text-amber-600 font-bold">{p.hectareas+" ha"}</span>}
                          <span className="text-[10px] text-amber-500">{acts.length+" actividades"}</span>
                        </div>
                      </div>
                      <span className="text-amber-500 text-xl">›</span>
                    </div>
                  </button>
                );
              })}
              {potreros.length===0&&!mostrarNuevo&&<div className="text-center py-8 text-amber-400"><p className="text-4xl mb-2">🗺️</p><p className="text-sm">Sin potreros</p></div>}
            </div>
          )}
          {potreroActivo&&(
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <button onClick={function(){setPotreroActivo(null);}} className="text-gray-700 text-sm font-bold">← Volver</button>
                <h3 className="text-gray-900 font-black text-lg flex-1">{potreroActivo.nombre}</h3>
                <button onClick={function(){ask("¿Eliminar potrero?",function(){onUpdate(Object.assign({},agro,{potreros:potreros.filter(function(x){return x.id!==potreroActivo.id;})}));setPotreroActivo(null);});}} className="text-red-500 text-xs border border-red-800 px-2 py-1 rounded-lg">🗑</button>
              </div>
              {potreroActivo.hectareas>0&&<p className="text-amber-600 text-sm">{potreroActivo.hectareas+" ha"}</p>}
              <div style={{background:"#f9fafb"}} className=" border border-amber-200 rounded-xl p-3 flex flex-col gap-2">
                <p className="text-xs font-black text-amber-700 uppercase">+ Actividad</p>
                <Sel label="Actividad" options={ACTIVIDADES_AGRO} value={formAct.actividad} onChange={function(e){setA("actividad",e.target.value);}}/>
                <Sel label="Cultivo (opcional)" options={CULTIVOS} value={formAct.cultivo} onChange={function(e){setA("cultivo",e.target.value);}}/>
                <div className="grid grid-cols-2 gap-2">
                  <Inp label="Fecha" type="date" value={formAct.fecha} onChange={function(e){setA("fecha",e.target.value);}}/>
                  <Inp label="Kg cosechados" type="number" placeholder="Solo cosecha" value={formAct.kgCosecha} onChange={function(e){setA("kgCosecha",e.target.value);}}/>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-green-600 font-bold uppercase">Obs.</label>
                  <textarea rows={2} value={formAct.obs} onChange={function(e){setA("obs",e.target.value);}}
                    className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-gray-800 text-sm focus:outline-none focus:border-green-400 resize-none"/>
                </div>
                <button onClick={function(){
                  if(!formAct.actividad)return;
                  onUpdate(Object.assign({},agro,{registros:[...registros,{id:Date.now(),fecha:formAct.fecha,actividad:formAct.actividad,cultivo:formAct.cultivo,potrero:potreroActivo.nombre,obs:formAct.obs,kgCosecha:formAct.kgCosecha?parseFloat(formAct.kgCosecha):null}]}));
                  setA("actividad","");setA("cultivo","");setA("obs","");setA("kgCosecha","");
                }} className="w-full bg-amber-400 text-amber-900 font-bold py-2 rounded-xl text-sm border border-amber-400">Guardar</button>
              </div>
              {(function(){
                var actsPot=registros.filter(function(r){return r.potrero===potreroActivo.nombre;});
                if(actsPot.length===0)return null;
                return(
                  <div className="flex items-center gap-2">
                    <label className="text-[10px] text-gray-500 uppercase font-bold">🌾 Tipo:</label>
                    <select value={tipoFiltro} onChange={function(e){setTipoFiltro(e.target.value);}} className="bg-gray-50 border border-gray-200 rounded-lg px-2 py-1 text-gray-800 text-xs font-bold focus:outline-none">
                      <option value="">Todos</option>
                      {ACTIVIDADES_AGRO.map(function(t){return <option key={t} value={t}>{t}</option>;})}
                    </select>
                  </div>
                );
              })()}
              {registros.filter(function(r){return r.potrero===potreroActivo.nombre&&(!tipoFiltro||r.actividad===tipoFiltro);}).length===0&&<p className="text-gray-400 text-sm text-center py-4">Sin actividades</p>}
              {[...registros].filter(function(r){return r.potrero===potreroActivo.nombre&&(!tipoFiltro||r.actividad===tipoFiltro);}).sort(function(a,b){return b.fecha.localeCompare(a.fecha);}).map(function(r){
                return(
                  <div key={r.id} className="bg-gray-50 border border-gray-100 rounded-xl px-4 py-3 flex items-start justify-between">
                    <div className="flex-1">
                      <p className="text-sm font-black text-gray-900">{r.actividad}</p>
                      {r.cultivo&&<span className="text-[10px] bg-amber-100 text-amber-700 border border-amber-300 px-2 py-0.5 rounded-full">{r.cultivo}</span>}
                      <p className="text-green-600 text-xs">{fmtFecha(r.fecha)}</p>
                      {r.kgCosecha&&<p className="text-amber-700 text-sm font-bold">{"🌾 "+r.kgCosecha.toLocaleString("es-AR")+" kg"+(potreroActivo.hectareas>0?" · "+(r.kgCosecha/potreroActivo.hectareas).toFixed(0)+" kg/ha":"")}</p>}
                      {r.obs&&<p className="text-gray-900 text-sm mt-1">{r.obs}</p>}
                    </div>
                    <button onClick={function(){ask("¿Eliminar?",function(){onUpdate(Object.assign({},agro,{registros:registros.filter(function(x){return x.id!==r.id;})}));});}} className="text-red-500 text-lg ml-2">✕</button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab==="actividad"&&(
        <div className="flex flex-col gap-3">
          <Sel label="Actividad" options={ACTIVIDADES_AGRO} value={formAct.actividad} onChange={function(e){setA("actividad",e.target.value);}}/>
          <div className="grid grid-cols-2 gap-3">
            <Inp label="Fecha" type="date" value={formAct.fecha} onChange={function(e){setA("fecha",e.target.value);}}/>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-green-600 font-bold uppercase">Potrero</label>
              <select value={formAct.potrero} onChange={function(e){setA("potrero",e.target.value);}} className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-gray-800 text-sm focus:outline-none focus:border-green-400">
                <option value="">— General —</option>
                {potreros.map(function(p){return <option key={p.id} value={p.nombre}>{p.nombre}</option>;})}
              </select>
            </div>
          </div>
          <Sel label="Cultivo (opcional)" options={CULTIVOS} value={formAct.cultivo} onChange={function(e){setA("cultivo",e.target.value);}}/>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-green-600 font-bold uppercase">Observaciones</label>
            <textarea rows={2} value={formAct.obs} onChange={function(e){setA("obs",e.target.value);}}
              className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-gray-800 text-sm focus:outline-none focus:border-green-400 resize-none"/>
          </div>
          <button onClick={function(){
            if(!formAct.actividad)return;
            onUpdate(Object.assign({},agro,{registros:[...registros,{id:Date.now(),fecha:formAct.fecha,actividad:formAct.actividad,cultivo:formAct.cultivo,potrero:formAct.potrero,obs:formAct.obs}]}));
            setA("actividad","");setA("obs","");setA("potrero","");setA("cultivo","");
          }} className="w-full bg-amber-400 text-amber-900 font-bold py-3 rounded-xl text-sm border border-amber-400">Guardar Actividad</button>
          <div className="flex flex-col gap-2 border-t border-gray-100 pt-3">
            <div className="flex items-center gap-2 flex-wrap">
              {(function(){var aA=aniosDe(registros);if(aA.length<=1)return null;var fc=registros.filter(function(r){return (!anioActi||(r.fecha&&r.fecha.substring(0,4)===anioActi))&&(!tipoFiltro||r.actividad===tipoFiltro);}).length;return <FiltroAnio anios={aA} valor={anioActi} onChange={function(e){setAnioActi(e.target.value);}} total={registros.length} filtrados={fc}/>;})()}
              {registros.length>0&&(
                <div className="flex items-center gap-2">
                  <label className="text-[10px] text-gray-500 uppercase font-bold">🌾 Tipo:</label>
                  <select value={tipoFiltro} onChange={function(e){setTipoFiltro(e.target.value);}} className="bg-gray-50 border border-gray-200 rounded-lg px-2 py-1 text-gray-800 text-xs font-bold focus:outline-none">
                    <option value="">Todos</option>
                    {ACTIVIDADES_AGRO.map(function(t){return <option key={t} value={t}>{t}</option>;})}
                  </select>
                </div>
              )}
            </div>
            {registros.length===0&&(
              <div className="text-center py-8">
                <p className="text-4xl mb-2">🌾</p>
                <p className="text-gray-700 font-bold text-sm mb-1">Sin actividades aún</p>
                <p className="text-gray-400 text-xs">Cargá siembras, cosechas, fumigaciones, etc.</p>
              </div>
            )}
            {[...registros].sort(function(a,b){return b.fecha.localeCompare(a.fecha);}).filter(function(r){return (!anioActi||(r.fecha&&r.fecha.substring(0,4)===anioActi))&&(!tipoFiltro||r.actividad===tipoFiltro);}).map(function(r){
              return(
                <div key={r.id} className="bg-gray-50 border border-gray-100 rounded-xl px-4 py-3 flex items-start justify-between">
                  <div className="flex-1">
                    <p className="text-sm font-black text-gray-900">{r.actividad}</p>
                    <div className="flex gap-1 flex-wrap mt-1">
                      {r.cultivo&&<span className="text-[10px] bg-amber-100 text-amber-700 border border-amber-300 px-2 py-0.5 rounded-full">{r.cultivo}</span>}
                      {r.potrero&&<span className="text-[10px] bg-emerald-100 text-gray-700 border border-emerald-200 px-2 py-0.5 rounded-full">{r.potrero}</span>}
                    </div>
                    <p className="text-gray-700 text-xs mt-1">{fmtFecha(r.fecha)}</p>
                    {r.obs&&<p className="text-gray-900 text-sm mt-1">{r.obs}</p>}
                  </div>
                  <button onClick={function(){ask("¿Eliminar?",function(){onUpdate(Object.assign({},agro,{registros:registros.filter(function(x){return x.id!==r.id;})}));});}} className="text-red-500 text-lg ml-2">✕</button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {tab==="gastos"&&(
        <div className="flex flex-col gap-3">
          {(function(){
            var gFilt=anioGasto?gastos.filter(function(g){return g.fecha&&g.fecha.substring(0,4)===anioGasto;}):gastos;
            var totalFilt=gFilt.reduce(function(s,g){return s+g.monto;},0);
            return(
              <div style={{background:"#fffbeb"}} className=" border border-amber-200 rounded-xl p-3 text-center">
                <p className="text-[10px] text-amber-600 uppercase font-bold">{"Total gastos"+(anioGasto?" "+anioGasto:"")}</p>
                <p className="text-2xl font-black text-amber-700">{"$"+totalFilt.toLocaleString("es-AR")}</p>
              </div>
            );
          })()}
          <Inp label="Concepto" placeholder="Ej: Herbicida, Gasoil..." value={formGasto.concepto} onChange={function(e){setG("concepto",e.target.value);}}/>
          <div className="grid grid-cols-2 gap-3">
            <Inp label="Monto ($)" type="number" placeholder="0" value={formGasto.monto} onChange={function(e){setG("monto",e.target.value);}}/>
            <Inp label="Fecha" type="date" value={formGasto.fecha} onChange={function(e){setG("fecha",e.target.value);}}/>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-green-600 font-bold uppercase">Potrero</label>
            <select value={formGasto.potrero} onChange={function(e){setG("potrero",e.target.value);}} className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-gray-800 text-sm focus:outline-none focus:border-green-400">
              <option value="">— General —</option>
              {potreros.map(function(p){return <option key={p.id} value={p.nombre}>{p.nombre}</option>;})}
            </select>
          </div>
          <button onClick={function(){
            if(!formGasto.concepto||!formGasto.monto)return;
            onUpdate(Object.assign({},agro,{gastos:[...gastos,{id:Date.now(),concepto:formGasto.concepto,monto:parseFloat(formGasto.monto),fecha:formGasto.fecha,potrero:formGasto.potrero}]}));
            setFormGasto({fecha:hoy(),concepto:"",monto:"",potrero:""});
          }} className="w-full bg-amber-400 text-amber-900 font-bold py-3 rounded-xl text-sm border border-amber-400">Guardar Gasto</button>
          <div className="flex flex-col gap-2 border-t border-gray-100 pt-3">
            {(function(){var aG=aniosDe(gastos);if(aG.length<=1)return null;var fc=anioGasto?gastos.filter(function(g){return g.fecha&&g.fecha.substring(0,4)===anioGasto;}).length:gastos.length;return <FiltroAnio anios={aG} valor={anioGasto} onChange={function(e){setAnioGasto(e.target.value);}} total={gastos.length} filtrados={fc}/>;})()}
            {gastos.length===0&&(
              <div className="text-center py-8">
                <p className="text-4xl mb-2">💰</p>
                <p className="text-gray-700 font-bold text-sm mb-1">Sin gastos cargados</p>
                <p className="text-gray-400 text-xs">Llevá el control de insumos, semillas, gasoil, etc.</p>
              </div>
            )}
            {[...gastos].sort(function(a,b){return b.fecha.localeCompare(a.fecha);}).filter(function(g){return !anioGasto||(g.fecha&&g.fecha.substring(0,4)===anioGasto);}).map(function(g){
              return(
                <div key={g.id} className="bg-gray-50 border border-gray-100 rounded-xl px-4 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-gray-900 font-bold text-sm">{g.concepto}</p>
                    <p className="text-green-600 text-xs">{fmtFecha(g.fecha)+(g.potrero?" · "+g.potrero:"")}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <p className="text-amber-700 font-black">{"$"+g.monto.toLocaleString("es-AR")}</p>
                    <button onClick={function(){ask("¿Eliminar?",function(){onUpdate(Object.assign({},agro,{gastos:gastos.filter(function(x){return x.id!==g.id;})}));});}} className="text-red-500 text-lg">✕</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {confirmDialog}
    </div>
  );
}

// ── Mover Masivo Modal ────────────────────────────────────────────────────────
function MoverMasivoModal({animales,lotes,onClose,onConfirm}){
  var [ask,confirmDialog]=useConfirm();
  var [destId,setDestId]=useState("");
  var destLote=destId?lotes.find(function(l){return l.id===parseInt(destId);}):null;
  return(
    <Modal title={"🔀 Mover "+animales.length+" animal"+(animales.length>1?"es":"")} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3">
          <p className="text-blue-800 font-bold text-sm">Se van a mover {animales.length} animal{animales.length>1?"es":""}</p>
          <p className="text-blue-700 text-xs mt-0.5">(Los filtrados actuales)</p>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-gray-500 uppercase font-bold">Lote destino</label>
          <select value={destId} onChange={function(e){setDestId(e.target.value);}} className="bg-white border border-gray-200 rounded-xl px-3 py-2.5 text-gray-900 text-sm focus:outline-none focus:border-gray-900">
            <option value="">— Elegir lote —</option>
            {lotes.map(function(l){return <option key={l.id} value={l.id}>{l.nombre+" ("+(l.animales||[]).length+" animales)"}</option>;})}
          </select>
        </div>
        <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto border border-gray-100 rounded-xl p-2">
          <p className="text-[10px] text-gray-500 uppercase font-bold">Animales a mover</p>
          {[...animales].sort(function(a,b){return a.caravana.localeCompare(b.caravana);}).map(function(a){
            return(
              <div key={a.id} className="flex items-center gap-2 text-xs">
                <span className="text-gray-700 font-bold">{a.caravana}</span>
                <span className="text-gray-500">{a.sexo+" · "+a.categoria}</span>
                {(a.marcas||[]).length>0&&<span>{a.marcas.map(function(m){return colorEmoji(m.color);}).join("")}</span>}
              </div>
            );
          })}
        </div>
        <button onClick={function(){
          if(!destId||!destLote)return;
          ask("¿Mover "+animales.length+" animales a "+destLote.nombre+"?",function(){onConfirm(parseInt(destId));});
        }} disabled={!destId} className={"w-full font-black py-3 rounded-xl text-base border "+(destId?"bg-blue-500 border-blue-500 text-white":"bg-gray-100 border-gray-200 text-gray-400")}>
          🔀 Confirmar movimiento
        </button>
        {confirmDialog}
      </div>
    </Modal>
  );
}

// ── Marca Masiva Form ─────────────────────────────────────────────────────────
function MarcaMasivaForm({count,onConfirm,onClose}){
  var [color,setColor]=useState("rojo");
  var [motivo,setMotivo]=useState("");
  var [custom,setCustom]=useState("");
  return(
    <div className="flex flex-col gap-3">
      <p className="text-sm text-gray-400">{"Se marcará"+(count>1?"n":"")+" "+count+" animal"+(count>1?"es":"")+" con:"}</p>
      <div className="flex gap-1">
        {[["rojo","🔴"],["amarillo","🟡"],["verde","🟢"],["azul","🔵"]].map(function(c){
          var active=color===c[0];
          return(
            <button key={c[0]} onClick={function(){setColor(c[0]);}}
              className={"flex-1 py-2 rounded-xl text-lg font-bold border "+(active?marcaColor(c[0]):"bg-gray-50 border-gray-200 text-gray-400")}>
              {c[1]}
            </button>
          );
        })}
      </div>
      <select value={motivo} onChange={function(e){setMotivo(e.target.value);}} className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-gray-800 text-sm focus:outline-none focus:border-green-400">
        <option value="">— Motivo —</option>
        {MARCAS_MOTIVOS.map(function(m){return <option key={m} value={m}>{m}</option>;})}
        <option value="__otro">✏️ Otro</option>
      </select>
      {motivo==="__otro"&&<input value={custom} onChange={function(e){setCustom(e.target.value);}} placeholder="Escribí el motivo..." autoFocus style={{background:"#f9fafb"}} className=" border border-gray-200 rounded-xl px-3 py-2 text-gray-900 text-sm focus:outline-none"/>}
      <button onClick={function(){
        var m=motivo==="__otro"?custom.trim():motivo;
        if(!m)return;
        onConfirm(color,m);
      }} style={{boxShadow:"0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.08)"}} className="w-full bg-emerald-600 text-white font-black py-3 rounded-xl border border-emerald-500">
        {"🏷️ Marcar "+count+" animal"+(count>1?"es":"")}
      </button>
    </div>
  );
}


// ── Vista Lote ────────────────────────────────────────────────────────────────
function VistaLote({loteId,allLotes,setLotes,onBack,establecimientos,setEstablecimientos,estId}){
  var lote=allLotes.find(function(l){return l.id===loteId;});
  var [vista,setVista]=useState("rodeo");
  var [showNuevo,setShowNuevo]=useState(false);
  var [detalleId,setDetalleId]=useState(null);
  var [busq,setBusq]=useState("");
  var [filtroCateg,setFiltroCateg]=useState("");
  var [filtroSexo,setFiltroSexo]=useState("");
  var [filtroPesoMin,setFiltroPesoMin]=useState("");
  var [filtroPesoMax,setFiltroPesoMax]=useState("");
  var [filtroMarca,setFiltroMarca]=useState("");
  var [filtrosVisible,setFiltrosVisible]=useState(false);
  var [showMarcaMasiva,setShowMarcaMasiva]=useState(false);
  var [showMoverMasivo,setShowMoverMasivo]=useState(false);
  var [resumenSesion,setResumenSesion]=useState(null);
  var [sesionPendienteReabrir,setSesionPendienteReabrir]=useState(null);
  var [showHistorial,setShowHistorial]=useState(false);
  var [showRenombrar,setShowRenombrar]=useState(false);
  var [showRepro,setShowRepro]=useState(false);
  var [showManga,setShowManga]=useState(false);
  var [reproDirecto,setReproDirecto]=useState(null);
  var [showSanidadMasiva,setShowSanidadMasiva]=useState(false);
  var [showCargarAnim,setShowCargarAnim]=useState(false);
  var [showMarcar,setShowMarcar]=useState(false);
  var [showAgro,setShowAgro]=useState(false);
  var [exportRodeo,setExportRodeo]=useState(null);
  var [ask,confirmDialog]=useConfirm();

  if(!lote)return null;

  var esAgro=lote.tipo==="agricultura";
  var esMixto=lote.tipo==="mixto";
  var animales=lote.animales||[];
  var sesiones=lote.sesiones||[];
  var sesionEnCurso=lote.sesionEnCurso||null;

  function agregar(a){
    logCambio("animal_creado","Nuevo animal "+a.caravana,"Lote: "+lote.nombre);
    // Iniciar historial de lotes con el lote actual
    var animalConHistorial=Object.assign({},a,{historialLotes:[{fecha:hoy(),lote:lote.nombre}]});
    setLotes(function(prev){return prev.map(function(l){return l.id===loteId?Object.assign({},l,{animales:[...l.animales,animalConHistorial]}):l;});});
  }
  function actualizar(a){
    setLotes(function(prev){
      return prev.map(function(l){
        // Lote original: si el animal se está moviendo, sacarlo. Si no, actualizarlo.
        if(l.id===loteId){
          if(a._moverA){
            return Object.assign({},l,{animales:l.animales.filter(function(x){return x.id!==a.id;})});
          }
          return Object.assign({},l,{animales:l.animales.map(function(x){return x.id===a.id?a:x;})});
        }
        // Lote destino: agregar el animal (sin _moverA) + agregar al historial
        if(a._moverA&&l.id===parseInt(a._moverA)){
          var clean=Object.assign({},a);
          delete clean._moverA;
          var hist=clean.historialLotes||[];
          // Evitar duplicar si ya era el último
          if(hist.length===0||hist[hist.length-1].lote!==l.nombre){
            hist=[...hist,{fecha:hoy(),lote:l.nombre}];
          }
          clean.historialLotes=hist;
          return Object.assign({},l,{animales:[...l.animales,clean]});
        }
        return l;
      });
    });
  }
  function eliminar(id){setLotes(function(prev){return prev.map(function(l){return l.id===loteId?Object.assign({},l,{animales:l.animales.filter(function(x){return x.id!==id;})}):l;});});}

  var detalleAnimal=detalleId?animales.find(function(a){return a.id===detalleId;}):null;
  var gdpVals=animales.map(function(a){return gdpTotal(a.pesajes);}).filter(function(v){return v!==null;}).map(Number);
  var gdpProm=gdpVals.length>0?(gdpVals.reduce(function(s,v){return s+v;},0)/gdpVals.length).toFixed(3):null;
  // Kg ganados total del lote: para cada animal (último peso - primer peso). Solo cuenta si tiene 2+ pesajes
  var kgGanadosLote=animales.reduce(function(suma,a){
    if(!a.pesajes||a.pesajes.length<2)return suma;
    var ord=[...a.pesajes].sort(function(x,y){return new Date(x.fecha)-new Date(y.fecha);});
    var dif=ord[ord.length-1].peso-ord[0].peso;
    return suma+(dif>0?dif:0);
  },0);
  var animalesConProgreso=animales.filter(function(a){return a.pesajes&&a.pesajes.length>=2;}).length;
  var totalMachos=animales.filter(function(a){return a.sexo==="Macho";}).length;
  var totalHembras=animales.filter(function(a){return a.sexo==="Hembra";}).length;
  var hayFiltros=!!(filtroCateg||filtroSexo||filtroPesoMin||filtroPesoMax||filtroMarca);
  var filtrados=animales.filter(function(a){
    var qb=busq.trim().toUpperCase();
    var up=ultimoPeso(a.pesajes);
    var marcaOk=!filtroMarca||(filtroMarca==="_sin"?!a.marcas||a.marcas.length===0:(a.marcas||[]).some(function(m){return m.color===filtroMarca;}));
    return (!qb||a.caravana.includes(qb)||((a.obs||"").toLowerCase().includes(busq.toLowerCase())))&&
      (!filtroCateg||a.categoria===filtroCateg)&&(!filtroSexo||a.sexo===filtroSexo)&&
      (!filtroPesoMin||up>=parseFloat(filtroPesoMin))&&(!filtroPesoMax||up<=parseFloat(filtroPesoMax))&&marcaOk;
  });

  function finalizarSesion(s){
    logCambio("sesion_pesaje","Sesión de pesaje finalizada","Lote: "+lote.nombre+" · "+s.registros.length+" animales");
    setLotes(function(prev){
      return prev.map(function(l){
        if(l.id!==loteId)return l;
        var animalesAct=l.animales.map(function(a){
          var reg=s.registros.find(function(r){return r.caravana===a.caravana;});
          if(!reg)return a;
          // Verificar si ya existe un pesaje con esta misma fecha y peso (duplicado del bug anterior)
          var pesajesActuales=a.pesajes||[];
          var yaExiste=pesajesActuales.some(function(p){return p.fecha===s.fecha&&p.peso===reg.peso;});
          if(yaExiste)return a; // No agregar si ya está
          return Object.assign({},a,{pesajes:[...pesajesActuales,{id:Date.now()+Math.random(),peso:reg.peso,fecha:s.fecha}]});
        });
        return Object.assign({},l,{animales:animalesAct,sesiones:[...(l.sesiones||[]),Object.assign({},s,{id:Date.now()})],sesionEnCurso:null});
      });
    });
    setVista("rodeo");
  }

  function updateAgro(agro){setLotes(function(prev){return prev.map(function(l){return l.id===loteId?Object.assign({},l,{agricultura:agro}):l;});});}

  function moverEst(destEstId,destLoteId){
    if(setEstablecimientos){
      setEstablecimientos(function(prev){
        // Obtener nombre del lote destino para agregar al historial
        var destEst=prev.find(function(e){return e.id===destEstId;});
        var destLote=destEst?destEst.lotes.find(function(l){return l.id===destLoteId;}):null;
        var nombreDestino=destLote?destLote.nombre:"";
        var animalConHist=Object.assign({},detalleAnimal);
        if(nombreDestino){
          var hist=animalConHist.historialLotes||[];
          if(hist.length===0||hist[hist.length-1].lote!==nombreDestino){
            hist=[...hist,{fecha:hoy(),lote:nombreDestino}];
          }
          animalConHist.historialLotes=hist;
        }
        return prev.map(function(e){
          if(e.id===estId)return Object.assign({},e,{lotes:e.lotes.map(function(l){return l.id===loteId?Object.assign({},l,{animales:l.animales.filter(function(a){return a.id!==detalleId;})}):l;})});
          if(e.id===destEstId)return Object.assign({},e,{lotes:e.lotes.map(function(l){return l.id===destLoteId?Object.assign({},l,{animales:[...l.animales,animalConHist]}):l;})});
          return e;
        });
      });
    }
    setDetalleId(null);
  }

  function venderAnimal(animal,datosVenta){
    if(!setEstablecimientos)return;
    // Armo el registro de venta: ficha completa del animal + info de la venta
    var registroVenta=Object.assign({},animal,{venta:datosVenta});
    setEstablecimientos(function(prev){
      return prev.map(function(e){
        if(e.id!==estId)return e;
        // Saco el animal del lote actual
        var nuevosLotes=e.lotes.map(function(l){
          if(l.id!==loteId)return l;
          return Object.assign({},l,{animales:l.animales.filter(function(a){return a.id!==animal.id;})});
        });
        // Lo agrego a la lista de vendidos
        var nuevosVendidos=[...(e.vendidos||[]),registroVenta];
        return Object.assign({},e,{lotes:nuevosLotes,vendidos:nuevosVendidos});
      });
    });
    setDetalleId(null);
  }

  if(showAgro){
    return(
      <div className="min-h-screen" style={{background:"#ffffff"}}>
        <header style={{background:"#ffffff"}} className=" border-b border-gray-200 px-4 py-3 sticky top-0 z-10">
          <div className="max-w-xl mx-auto flex items-center gap-3">
            <button onClick={function(){setShowAgro(false);}} className="btn-flash bg-gray-100 text-gray-800 text-2xl font-bold w-11 h-11 rounded-full flex items-center justify-center border border-gray-200">&larr;</button>
            <h1 className="text-xl font-black text-white">{"🌾 "+lote.nombre}</h1>
          </div>
        </header>
        <div className="max-w-xl mx-auto px-4 py-4">
          <AgroVistaLote agro={lote.agricultura||{registros:[],gastos:[],potreros:[]}} onUpdate={updateAgro} loteNombre={lote.nombre}/>
        </div>
      </div>
    );
  }

  if(vista==="manga"){
    return(
      <SesionPesaje
        loteId={loteId} allLotes={allLotes} setLotes={setLotes}
        nombreLote={lote.nombre} sesionInicial={sesionEnCurso}
        onPausar={function(s){setLotes(function(prev){return prev.map(function(l){return l.id===loteId?Object.assign({},l,{sesionEnCurso:s}):l;});});setVista("rodeo");}}
        onFinalizar={function(s){setResumenSesion(s);finalizarSesion(s);}}
      />
    );
  }

  var tipoIcon=esAgro?"🌾":esMixto?"🔄":"🐄";
  var tipoColor=esAgro?"#d4d060":esMixto?"#9090d0":"#c8e6a0";

  return(
    <div className="min-h-screen" style={{background:"#ffffff",color:"#1a1a1a"}}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600;700;900&display=swap" rel="stylesheet"/>
      <header className="px-4 py-2 sticky top-0 z-10" style={{background:"#ffffff",borderBottom:"1px solid #e5e7eb"}}>
        <div className="max-w-xl mx-auto">
          <div className="flex items-center justify-center gap-3 py-1">
            <h1 className="text-3xl font-black tracking-tight" style={{color:"#1a4a10"}}>{tipoIcon+" "+lote.nombre}</h1>
            {!esAgro&&<span className="text-sm font-bold text-emerald-600 bg-emerald-100 border border-emerald-200 px-2 py-1 rounded-full">{animales.length+" 🐄"}</span>}
          </div>
          {!esAgro&&kgGanadosLote>0&&(
            <p className="text-center text-xs text-gray-500 -mt-0.5 mb-1">📈 +{kgGanadosLote.toLocaleString("es-AR")} kg ganados {animalesConProgreso<animales.length?"("+animalesConProgreso+" animales)":""}{gdpProm?" · GDP "+gdpProm+" kg/d":""}</p>
          )}
          <div className="flex items-center justify-between mt-1">
            <button onClick={onBack} className="btn-flash bg-gray-100 text-gray-800 text-2xl font-bold w-11 h-11 rounded-full flex items-center justify-center border border-gray-200">&larr;</button>
            {!esAgro&&(
              <div className="flex gap-2">
                {esMixto&&<button onClick={function(){setShowAgro(true);}} style={{boxShadow:"0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.08)"}} className="btn-flash bg-amber-400 text-amber-900 font-bold px-3 py-2 rounded-xl text-sm border border-amber-400">🌾 Agro</button>}

                <button onClick={function(){setShowHistorial(true);}} style={{boxShadow:"0 1px 3px rgba(0,0,0,0.12)"}} className="btn-flash bg-white border border-gray-200 text-gray-700 font-bold px-3 py-2 rounded-xl text-sm">📅{sesiones.length>0?" "+sesiones.length:""}</button>
                <button onClick={function(){if(sesionEnCurso){setVista("manga");}else{setShowManga(true);}}} style={{boxShadow:"0 1px 3px rgba(0,0,0,0.12)"}} className={"btn-flash font-bold px-3 py-2 rounded-xl text-sm border "+(sesionEnCurso?"bg-amber-500 border-amber-500 text-white":"bg-sky-400 border-sky-400 text-white")}>
                  {sesionEnCurso?"⚖️ Retomar":"🐂 Manga"}
                </button>
                <button onClick={function(){setShowNuevo(true);}} style={{boxShadow:"0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.08)"}} className="btn-flash bg-emerald-300 text-white font-black px-3 py-2 rounded-xl text-sm border border-emerald-300">+ Animal</button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-xl mx-auto px-4 py-4 flex flex-col gap-4">
        {esAgro&&(
          <AgroVistaLote agro={lote.agricultura||{registros:[],gastos:[],potreros:[]}} onUpdate={updateAgro} loteNombre={lote.nombre}/>
        )}
        {!esAgro&&(
          <>
            {sesionEnCurso&&sesionEnCurso.registros&&sesionEnCurso.registros.length>0&&(
              <button onClick={function(){setVista("manga");}} className="w-full text-left bg-amber-950/30 border border-amber-800/60 rounded-2xl px-4 py-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-amber-400 text-lg">⏸</span>
                    <div><p className="text-amber-300 font-bold text-sm">{"Sesión en curso — "+fmtFecha(sesionEnCurso.fecha)}</p><p className="text-amber-700 text-xs">{sesionEnCurso.registros.length+" pesajes · Tocá para retomar"}</p></div>
                  </div>
                  <span className="text-amber-500 text-lg">▶</span>
                </div>
              </button>
            )}
            {sesiones.length>0&&!sesionEnCurso&&(function(){
              var ult=[...sesiones].sort(function(a,b){return b.fecha.localeCompare(a.fecha);})[0];
              var totalKg=ult.registros.reduce(function(s,r){return s+r.peso;},0);
              return(
                <button onClick={function(){setResumenSesion(ult);}} className="w-full text-left bg-emerald-50 border border-emerald-200 rounded-2xl px-4 py-3">
                  <div className="flex items-center justify-between">
                    <div><p className="text-[10px] text-emerald-600 uppercase font-bold">Última sesión</p><p className="text-gray-800 font-bold text-sm">{fmtFecha(ult.fecha)}</p></div>
                    <div className="flex gap-4 text-right">
                      <div><p className="text-emerald-700 font-bold">{ult.registros.length}</p><p className="text-[9px] text-gray-500 uppercase">animales</p></div>
                      <div><p className="text-emerald-700 font-bold">{totalKg.toLocaleString("es-AR")}</p><p className="text-[9px] text-gray-500 uppercase">kg</p></div>
                    </div>
                  </div>
                </button>
              );
            })()}

            <button onClick={function(){setShowRepro(true);}} style={{boxShadow:"0 1px 3px rgba(0,0,0,0.12)"}} className="w-full bg-rose-300 text-white font-black py-3 rounded-xl text-base border border-rose-300">🐄 Gestión Reproductiva</button>
            <div className="grid grid-cols-3 gap-2">
              {[
                {icon:"🐄",val:animales.length,label:"Total"},
                {icon:"⚥",val:totalMachos+"M / "+totalHembras+"H",label:"Sexo"},
                {icon:"📈",val:gdpProm?gdpProm+" kg/d":"—",label:"GDP prom."}
              ].map(function(s){
                return(
                  <div key={s.label} style={{background:"#ffffff"}} className=" border border-gray-200 rounded-2xl p-3 text-center">
                    <p className="text-base">{s.icon}</p>
                    <p className="text-gray-900 font-bold text-sm leading-tight mt-0.5">{s.val}</p>
                    <p className="text-[9px] text-gray-400 mt-0.5 uppercase tracking-wider">{s.label}</p>
                  </div>
                );
              })}
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex gap-2">
                <input value={busq} onChange={function(e){setBusq(e.target.value);}} placeholder="🔍 Buscar caravana..."
                  className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-gray-900 text-sm focus:outline-none focus:border-emerald-400 placeholder-gray-400"/>
                <button onClick={function(){setFiltrosVisible(function(v){return !v;});}} className={"px-3 py-2 rounded-xl text-xs font-bold border "+(hayFiltros?"bg-emerald-200 border-emerald-400 text-gray-900":"bg-gray-50 border-gray-200 text-gray-500")}>
                  {"⚙ Filtros"+(hayFiltros?" ("+(([filtroCateg,filtroSexo,filtroPesoMin,filtroPesoMax].filter(Boolean).length)+")"):"") }
                </button>
              </div>
              {hayFiltros&&filtrados.length>0&&(
              <div className="flex items-center justify-between py-1 gap-2 flex-wrap">
                <p className="text-xs text-gray-500">{filtrados.length+" animales filtrados"}</p>
                <div className="flex gap-2 flex-wrap">
                  <button onClick={function(){setShowMarcaMasiva(true);}} className="text-xs bg-gray-100 border border-gray-200 text-gray-700 font-bold px-3 py-1.5 rounded-xl">🏷️ Marcar</button>
                  {(function(){
                    var otros=allLotes.filter(function(l){return l.id!==loteId&&l.tipo!=="agricultura";});
                    if(otros.length===0)return null;
                    return <button onClick={function(){setShowMoverMasivo(true);}} className="text-xs bg-blue-50 border border-blue-200 text-blue-700 font-bold px-3 py-1.5 rounded-xl">🔀 Mover</button>;
                  })()}
                  {filtrados.some(function(a){return (a.marcas||[]).length>0;})&&(
                    <button onClick={function(){
                      setLotes(function(prev){
                        return prev.map(function(l){
                          if(l.id!==loteId)return l;
                          return Object.assign({},l,{animales:l.animales.map(function(a){
                            var esFiltrado=filtrados.find(function(f){return f.id===a.id;});
                            return esFiltrado?Object.assign({},a,{marcas:[]}):a;
                          })});
                        });
                      });
                    }} className="text-xs bg-pink-50 border border-pink-200 text-pink-600 font-bold px-3 py-1.5 rounded-xl">✕ Desmarcar</button>
                  )}
                </div>
              </div>
            )}
            {filtrosVisible&&(
                <div style={{background:"#f9fafb"}} className=" border border-gray-200 rounded-2xl p-3 flex flex-col gap-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] text-gray-500 uppercase font-bold">Categoría</label>
                      <select value={filtroCateg} onChange={function(e){setFiltroCateg(e.target.value);}} style={{background:"#ffffff"}} className=" border border-gray-200 rounded-xl px-2 py-2 text-gray-900 text-sm focus:outline-none">
                        <option value="">Todas</option>
                        {CATEGORIAS.map(function(c){return <option key={c} value={c}>{c}</option>;})}
                      </select>
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] text-gray-500 uppercase font-bold">Sexo</label>
                      <select value={filtroSexo} onChange={function(e){setFiltroSexo(e.target.value);}} style={{background:"#ffffff"}} className=" border border-gray-200 rounded-xl px-2 py-2 text-gray-900 text-sm focus:outline-none">
                        <option value="">Todos</option><option value="Macho">Macho</option><option value="Hembra">Hembra</option>
                      </select>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] text-gray-500 uppercase font-bold">Peso (kg)</label>
                    <div className="grid grid-cols-2 gap-2">
                      <input type="number" placeholder="Mín" value={filtroPesoMin} onChange={function(e){setFiltroPesoMin(e.target.value);}} className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-gray-900 text-sm focus:outline-none"/>
                      <input type="number" placeholder="Máx" value={filtroPesoMax} onChange={function(e){setFiltroPesoMax(e.target.value);}} className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-gray-900 text-sm focus:outline-none"/>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] text-gray-500 uppercase font-bold">Marca</label>
                    <div className="flex gap-1 flex-wrap">
                      <button onClick={function(){setFiltroMarca("");}} className={"px-3 py-1.5 rounded-lg text-xs font-bold border "+(filtroMarca===""?"bg-gray-900 border-gray-900 text-white":"bg-white border-gray-200 text-gray-600")}>Todos</button>
                      {[["rojo","🔴"],["amarillo","🟡"],["verde","🟢"],["azul","🔵"]].map(function(c){
                        return <button key={c[0]} onClick={function(){setFiltroMarca(c[0]);}} className={"px-3 py-1.5 rounded-lg text-sm font-bold border "+(filtroMarca===c[0]?marcaColor(c[0]):"bg-white border-gray-200")}>{c[1]}</button>;
                      })}
                      <button onClick={function(){setFiltroMarca("_sin");}} className={"px-3 py-1.5 rounded-lg text-xs font-bold border "+(filtroMarca==="_sin"?"bg-gray-200 border-gray-400 text-gray-700":"bg-white border-gray-200 text-gray-500")}>Sin marca</button>
                    </div>
                  </div>
                  {hayFiltros&&<button onClick={function(){setFiltroCateg("");setFiltroSexo("");setFiltroPesoMin("");setFiltroPesoMax("");setFiltroMarca("");}} className="text-xs text-gray-600 text-left">✕ Limpiar filtros</button>
                  }
                </div>
              )}
            </div>

            {filtrados.length===0?(
              <div className="text-center py-12">
                {animales.length===0?(
                  <>
                    <p className="text-5xl mb-3">🐄</p>
                    <p className="text-gray-800 font-bold text-base mb-1">Aún no hay animales</p>
                    <p className="text-gray-500 text-xs mb-2">Empezá cargando uno por uno</p>
                    <p className="text-emerald-600 text-xs font-bold">Tocá "+ Animal" arriba</p>
                  </>
                ):(
                  <>
                    <p className="text-4xl mb-3">🔍</p>
                    <p className="text-gray-500 text-sm">Sin resultados</p>
                    <p className="text-gray-400 text-xs">Probá cambiar la búsqueda o los filtros</p>
                  </>
                )}
              </div>
            ):(
              <div className="flex flex-col gap-2">
                {[...filtrados].sort(function(a,b){return a.caravana.localeCompare(b.caravana);}).map(function(a){
                  var g=gdpTotal(a.pesajes);
                  var up=ultimoPeso(a.pesajes);
                  return(
                    <button key={a.id} onClick={function(){setDetalleId(a.id);}} className={"w-full text-left rounded-2xl px-4 py-3 transition-all border "+marcaBgCard(a.marcas)} style={(a.marcas&&a.marcas.length>0)?{color:"#1a1a1a"}:{}}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className={(a.marcas&&a.marcas.length>0)?"rounded-xl w-10 h-10 flex items-center justify-center font-black text-white border text-sm bg-gray-600 border-gray-400":"bg-gray-100 rounded-xl w-10 h-10 flex items-center justify-center font-black text-emerald-600 border border-gray-200 text-sm"}>{a.caravana.slice(-2)}</div>
                          <div>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <p className="font-bold text-gray-900 text-sm">{a.caravana}</p>
                              {(a.marcas||[]).map(function(m){
                                return <span key={m.id} className={"text-xs px-3 py-1 rounded-full font-bold border ml-auto text-center "+marcaColor(m.color)}>{colorEmoji(m.color)+" "+m.motivo}</span>;
                              })}
                            </div>
                            <div className="flex gap-1.5 mt-0.5"><Badge text={a.sexo} color={a.sexo==="Macho"?"macho":"hembra"}/><Badge text={a.categoria}/></div>
                          </div>
                        </div>
                        <div className="text-right">
                          {up&&<p className="text-gray-800 font-bold text-sm">{up+" kg"}</p>}
                          {g!==null&&<p className={"text-xs font-semibold "+(parseFloat(g)>=0?"text-green-400":"text-red-400")}>{(parseFloat(g)>=0?"▲":"▼")+" "+Math.abs(g)+" kg/d"}</p>}
                          {!up&&<p className="text-gray-300 text-xs">Sin pesaje</p>}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            <div className="border-t border-gray-200 pt-3 flex flex-col gap-2">
              <button onClick={function(){setExportRodeo(exportDatosRodeo(animales,lote.nombre));}} className="w-full bg-gray-50 border border-gray-200 text-gray-700 font-bold py-2.5 rounded-xl text-sm flex items-center justify-center gap-2">
                📊 Exportar rodeo a Excel
              </button>
              {exportRodeo&&<ExportModal {...exportRodeo} onClose={function(){setExportRodeo(null);}}/>}
            </div>
          </>
        )}

        <div className="flex gap-2">
          <button onClick={function(){setShowRenombrar(true);}} className="flex-1 text-xs text-gray-600 border border-gray-200 py-2 rounded-xl">✏️ Renombrar</button>
          <button onClick={function(){ask("¿Eliminar lote "+lote.nombre+"?",function(){setLotes(function(prev){return prev.filter(function(l){return l.id!==loteId;});});onBack();});}} className="flex-1 text-xs text-red-600 border border-red-900 py-2 rounded-xl">🗑 Eliminar lote</button>
        </div>
      </main>

      {showMoverMasivo&&(
        <MoverMasivoModal
          animales={filtrados}
          lotes={allLotes.filter(function(l){return l.id!==loteId&&l.tipo!=="agricultura";})}
          onClose={function(){setShowMoverMasivo(false);}}
          onConfirm={function(destId){
            var idsAMover=filtrados.map(function(a){return a.id;});
            var animMov=filtrados;
            var destLote=allLotes.find(function(l){return l.id===destId;});
            logCambio("animales_movidos","Movidos "+animMov.length+" animales","De "+lote.nombre+" a "+(destLote?destLote.nombre:"otro lote"));
            setLotes(function(prev){
              return prev.map(function(l){
                if(l.id===loteId)return Object.assign({},l,{animales:l.animales.filter(function(a){return !idsAMover.includes(a.id);})});
                if(l.id===destId)return Object.assign({},l,{animales:[...l.animales,...animMov]});
                return l;
              });
            });
            setShowMoverMasivo(false);
          }}
        />
      )}
      {showMarcaMasiva&&(
        <Modal title={"🏷️ Marcar "+filtrados.length+" animales"} onClose={function(){setShowMarcaMasiva(false);}}>
          <MarcaMasivaForm
            count={filtrados.length}
            onConfirm={function(color,motivo){
              var nuevaMarca={id:Date.now(),color,motivo};
              setLotes(function(prev){
                return prev.map(function(l){
                  if(l.id!==loteId)return l;
                  return Object.assign({},l,{animales:l.animales.map(function(a){
                    var esFiltrado=filtrados.find(function(f){return f.id===a.id;});
                    if(!esFiltrado)return a;
                    var yaExiste=(a.marcas||[]).find(function(m){return m.color===color&&m.motivo===motivo;});
                    if(yaExiste)return a;
                    return Object.assign({},a,{marcas:[...(a.marcas||[]),Object.assign({},nuevaMarca,{id:Date.now()+Math.random()})]});
                  })});
                });
              });
              setShowMarcaMasiva(false);
            }}
            onClose={function(){setShowMarcaMasiva(false);}}
          />
        </Modal>
      )}
      {showNuevo&&<NuevoAnimalModal onClose={function(){setShowNuevo(false);}} onSave={agregar}/>}
      {detalleAnimal&&<DetalleModal key={detalleAnimal.id} animal={detalleAnimal} onClose={function(){
        setDetalleId(null);
        if(sesionPendienteReabrir){
          var ses=sesionPendienteReabrir;
          setSesionPendienteReabrir(null);
          setResumenSesion(ses);
        }
      }} onUpdate={actualizar} onDelete={eliminar} lotes={allLotes} loteActualId={loteId} establecimientos={establecimientos} estId={estId} onMoverEst={moverEst} onVender={venderAnimal} nombreLote={lote.nombre} reproSesionesLote={lote.reproSesiones||[]}/>}
      {resumenSesion&&<ResumenSesionModal sesion={resumenSesion} nombreLote={lote.nombre} animales={animales} onVerAnimal={function(id){setSesionPendienteReabrir(resumenSesion);setResumenSesion(null);setDetalleId(id);}} onClose={function(){setResumenSesion(null);}}/>}
      {showHistorial&&<HistorialModal sesiones={sesiones} onClose={function(){setShowHistorial(false);}} onVerSesion={function(s){setShowHistorial(false);setResumenSesion(s);}} onEliminarSesion={function(id){setLotes(function(prev){return prev.map(function(l){return l.id===loteId?Object.assign({},l,{sesiones:l.sesiones.filter(function(s){return s.id!==id;})}):l;});});}}/>}
      {showCargarAnim&&<CargarAnimalesModal lote={lote} onClose={function(){setShowCargarAnim(false);}}
        onAgregarAnimales={function(nuevos){
          // Agregar todos al lote, registrar logCambio y historial de lotes
          var conHist=nuevos.map(function(n){
            return Object.assign({},n,{historialLotes:[{fecha:hoy(),lote:lote.nombre}]});
          });
          logCambio("animales_creados","Se cargaron "+nuevos.length+" animales","Lote: "+lote.nombre);
          setLotes(function(prev){return prev.map(function(l){return l.id===loteId?Object.assign({},l,{animales:[...l.animales,...conHist]}):l;});});
        }}
      />}
      {showMarcar&&<MarcarAnimalesModal lote={lote} onClose={function(){setShowMarcar(false);}}
        onUpdate={function(animalesAct){
          setLotes(function(prev){return prev.map(function(l){return l.id===loteId?Object.assign({},l,{animales:animalesAct}):l;});});
        }}
        onUpdateSesiones={function(sesionesNuevas){
          setLotes(function(prev){return prev.map(function(l){return l.id===loteId?Object.assign({},l,{marcasSesiones:sesionesNuevas}):l;});});
        }}
      />}
      {showSanidadMasiva&&<SanidadMasivaModal lote={lote} onClose={function(){setShowSanidadMasiva(false);}}
        onUpdate={function(animalesAct){
          setLotes(function(prev){return prev.map(function(l){return l.id===loteId?Object.assign({},l,{animales:animalesAct}):l;});});
        }}
        onUpdateSesiones={function(sesionesNuevas){
          setLotes(function(prev){return prev.map(function(l){return l.id===loteId?Object.assign({},l,{sanidadSesiones:sesionesNuevas}):l;});});
        }}
        onCrearAlerta={function(alerta){
          if(setEstablecimientos&&estId){
            setEstablecimientos(function(prev){return prev.map(function(e){
              if(e.id!==estId)return e;
              var nueva=Object.assign({id:Date.now()+Math.random()},alerta);
              return Object.assign({},e,{alertas:[...(e.alertas||[]),nueva]});
            });});
          }
        }}
      />}
      {showRepro&&<ReproModal lote={lote} toros={establecimientos?(establecimientos.find(function(e){return e.id===estId;})||{}).toros||[]:lote.toros||[]} tipoDirecto={reproDirecto} onClose={function(){setShowRepro(false);setReproDirecto(null);}} onUpdate={function(sesion,nuevosAnimales,deleteId){
        setLotes(function(prev){
          return prev.map(function(l){
            if(l.id!==loteId)return l;
            var ses=l.reproSesiones||[];
            if(deleteId)ses=ses.filter(function(x){return x.id!==deleteId;});
            else if(sesion)ses=[...ses,sesion];
            var base=Object.assign({},l,{reproSesiones:ses});
            if(nuevosAnimales)base=Object.assign({},base,{animales:nuevosAnimales});
            return base;
          });
        });
      }}/>}
      {showManga&&(
        <Modal title="🐂 Trabajos de manga" onClose={function(){setShowManga(false);}}>
          <div className="flex flex-col gap-2">
            <p className="text-xs text-gray-500 mb-1">Elegí qué trabajo querés hacer:</p>
            <button onClick={function(){setShowManga(false);setVista("manga");}} style={{boxShadow:"0 1px 3px rgba(0,0,0,0.12)"}} className="w-full bg-sky-50 border border-sky-200 text-sky-800 font-bold py-3 rounded-xl text-sm flex items-center gap-3 px-4">
              <span className="text-2xl">⚖️</span>
              <div className="text-left flex-1">
                <p className="font-black">Pesar</p>
                <p className="text-[10px] text-sky-600 font-normal">Sesión de pesaje</p>
              </div>
              <span className="text-sky-400">›</span>
            </button>
            <button onClick={function(){setShowManga(false);setReproDirecto("tacto");setShowRepro(true);}} style={{boxShadow:"0 1px 3px rgba(0,0,0,0.12)"}} className="w-full bg-pink-50 border border-pink-200 text-pink-800 font-bold py-3 rounded-xl text-sm flex items-center gap-3 px-4">
              <span className="text-2xl">🔍</span>
              <div className="text-left flex-1">
                <p className="font-black">Tacto</p>
                <p className="text-[10px] text-pink-600 font-normal">Chequear preñez</p>
              </div>
              <span className="text-pink-400">›</span>
            </button>
            <button onClick={function(){setShowManga(false);setReproDirecto("servicio");setShowRepro(true);}} style={{boxShadow:"0 1px 3px rgba(0,0,0,0.12)"}} className="w-full bg-pink-50 border border-pink-200 text-pink-800 font-bold py-3 rounded-xl text-sm flex items-center gap-3 px-4">
              <span className="text-2xl">💉</span>
              <div className="text-left flex-1">
                <p className="font-black">Servicio</p>
                <p className="text-[10px] text-pink-600 font-normal">Registrar monta o IA</p>
              </div>
              <span className="text-pink-400">›</span>
            </button>
            <button onClick={function(){setShowManga(false);setReproDirecto("parto");setShowRepro(true);}} style={{boxShadow:"0 1px 3px rgba(0,0,0,0.12)"}} className="w-full bg-pink-50 border border-pink-200 text-pink-800 font-bold py-3 rounded-xl text-sm flex items-center gap-3 px-4">
              <span className="text-2xl">🐄</span>
              <div className="text-left flex-1">
                <p className="font-black">Parto</p>
                <p className="text-[10px] text-pink-600 font-normal">Registrar nacimiento</p>
              </div>
              <span className="text-pink-400">›</span>
            </button>
            <button onClick={function(){setShowManga(false);setShowSanidadMasiva(true);}} style={{boxShadow:"0 1px 3px rgba(0,0,0,0.12)"}} className="w-full bg-purple-50 border border-purple-200 text-purple-800 font-bold py-3 rounded-xl text-sm flex items-center gap-3 px-4">
              <span className="text-2xl">💊</span>
              <div className="text-left flex-1">
                <p className="font-black">Sanidad masiva</p>
                <p className="text-[10px] text-purple-600 font-normal">Vacunar/desparasitar varios juntos</p>
              </div>
              <span className="text-purple-400">›</span>
            </button>
            <button onClick={function(){setShowManga(false);setShowCargarAnim(true);}} style={{boxShadow:"0 1px 3px rgba(0,0,0,0.12)"}} className="w-full bg-emerald-50 border border-emerald-200 text-emerald-800 font-bold py-3 rounded-xl text-sm flex items-center gap-3 px-4">
              <span className="text-2xl">🆕</span>
              <div className="text-left flex-1">
                <p className="font-black">Cargar animales</p>
                <p className="text-[10px] text-emerald-600 font-normal">Dar de alta varios juntos</p>
              </div>
              <span className="text-emerald-400">›</span>
            </button>
            <button onClick={function(){setShowManga(false);setShowMarcar(true);}} style={{boxShadow:"0 1px 3px rgba(0,0,0,0.12)"}} className="w-full bg-amber-50 border border-amber-200 text-amber-800 font-bold py-3 rounded-xl text-sm flex items-center gap-3 px-4">
              <span className="text-2xl">🏷️</span>
              <div className="text-left flex-1">
                <p className="font-black">Marcar / Señalar</p>
                <p className="text-[10px] text-amber-600 font-normal">Marca, tatuaje, mocheta, aro</p>
              </div>
              <span className="text-amber-400">›</span>
            </button>
          </div>
        </Modal>
      )}
      {confirmDialog}
      {showRenombrar&&<NuevoLoteModal loteEditar={lote} onClose={function(){setShowRenombrar(false);}} onSave={function(nombre){setLotes(function(prev){return prev.map(function(l){return l.id===loteId?Object.assign({},l,{nombre}):l;});});}}/>}
    </div>
  );
}

// ── Vista Establecimiento ─────────────────────────────────────────────────────
function VistaEstablecimiento({estId,establecimientos,setEstablecimientos,onBack}){
  var est=establecimientos.find(function(e){return e.id===estId;});
  var [lotes,setLotesLocal]=useState(est?est.lotes||[]:[]);
  var [loteActivoId,setLoteActivoId]=useState(null);
  var [showNuevoLote,setShowNuevoLote]=useState(false);
  var [showAlertas,setShowAlertas]=useState(false);
  var [showToros,setShowToros]=useState(false);
  var [showVendidos,setShowVendidos]=useState(false);
  var [showCuaderno,setShowCuaderno]=useState(false);
  var [showRenombrar,setShowRenombrar]=useState(false);
  var [ask,confirmDialog]=useConfirm();

  useEffect(function(){
    if(est)setLotesLocal(est.lotes||[]);
  },[est]);

  function setLotes(updater){
    setLotesLocal(function(prev){
      var next=typeof updater==="function"?updater(prev):updater;
      setEstablecimientos(function(ests){return ests.map(function(e){return e.id===estId?Object.assign({},e,{lotes:next}):e;});});
      return next;
    });
  }

  if(!est)return null;

  var alertas=est.alertas||[];
  var alertasActivas=alertas.filter(function(a){
    var est2=estadoAlerta(a.fechaHora,a.pasada);
    return est2==="urgente"||est2==="pronto";
  });

  if(loteActivoId){
    return(
      <VistaLote
        loteId={loteActivoId} allLotes={lotes} setLotes={setLotes}
        onBack={function(){setLoteActivoId(null);}}
        establecimientos={establecimientos} setEstablecimientos={setEstablecimientos} estId={estId}
      />
    );
  }

  return(
    <div className="min-h-screen" style={{background:"#ffffff"}}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600;700;900&display=swap" rel="stylesheet"/>
      <header className="px-4 py-2 sticky top-0 z-10" style={{background:"#ffffff",borderBottom:"1px solid #e5e7eb"}}>
        <div className="max-w-xl mx-auto">
          <div className="flex items-center justify-center py-1">
            <h1 className="text-3xl font-black text-gray-900 tracking-tight">{est.nombre}</h1>
          </div>
          <div className="flex items-center justify-between mt-1">
            <button onClick={onBack} className="btn-flash bg-gray-100 text-gray-800 text-2xl font-bold w-11 h-11 rounded-full flex items-center justify-center border border-gray-200">&larr;</button>
            <div className="flex gap-2">
              <button onClick={function(){setShowToros(true);}} style={{boxShadow:"0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.08)"}} className="btn-flash bg-white border border-gray-200 text-gray-700 font-bold px-4 py-3 rounded-xl text-base">🐂 Toros</button>
              <button onClick={function(){setShowCuaderno(true);}} style={{boxShadow:"0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.08)"}} className="btn-flash bg-white border border-gray-200 text-gray-700 font-bold px-4 py-3 rounded-xl text-2xl">📓</button>
              <button onClick={function(){setShowVendidos(true);}} style={{boxShadow:"0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.08)"}} className="btn-flash bg-white border border-gray-200 text-gray-700 font-bold px-4 py-3 rounded-xl text-2xl">{"💰"+((est.vendidos||[]).length>0?" "+(est.vendidos||[]).length:"")}</button>
              <button onClick={function(){setShowNuevoLote(true);}} style={{boxShadow:"0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.08)"}} className="btn-flash bg-emerald-300 text-white font-black px-5 py-3 rounded-xl text-base border border-emerald-300">+ Lote</button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-xl mx-auto px-4 py-4 flex flex-col gap-3">
        {alertasActivas.length>0?(
          <button onClick={function(){setShowAlertas(true);}} className="w-full text-left bg-amber-50 border border-amber-300 rounded-2xl px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-2xl">🔔</span>
              <p className="text-amber-800 font-bold text-sm">{alertasActivas.length+" alerta"+(alertasActivas.length>1?"s":"")+" pendiente"+(alertasActivas.length>1?"s":"")}</p>
            </div>
            <span className="text-amber-700 text-sm font-bold">Ver →</span>
          </button>
        ):(
          <button onClick={function(){setShowAlertas(true);}} className="w-full text-left bg-white border border-gray-200 rounded-2xl px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-2xl">🔔</span>
              <p className="text-gray-700 font-bold text-sm">Sin alertas pendientes</p>
            </div>
            <span className="text-emerald-600 text-sm font-bold">+ Nueva</span>
          </button>
        )}

        {lotes.length===0&&(
          <div className="bg-gray-50 border border-gray-200 rounded-2xl p-6 text-center">
            <p className="text-5xl mb-3">🐄</p>
            <p className="text-gray-800 font-bold text-base mb-1">Creá tu primer lote</p>
            <p className="text-gray-500 text-xs mb-2">Los lotes son grupos de animales</p>
            <p className="text-gray-400 text-xs">Ejemplos: <b>Vaquillonas</b>, <b>Toros</b>, <b>Engorde</b>, <b>Cría</b>, <b>Recría</b></p>
            <p className="text-emerald-600 text-xs mt-3 font-bold">Tocá "+ Lote" arriba para crear uno</p>
          </div>
        )}

        {lotes.map(function(lote){
          var animales=lote.animales||[];
          var tipoIcon=lote.tipo==="agricultura"?"🌾":lote.tipo==="mixto"?"🔄":"🐄";
          var tipoColor=lote.tipo==="agricultura"?"#d4d060":lote.tipo==="mixto"?"#9090d0":"#a0d060";
          return(
            <button key={lote.id} onClick={function(){setLoteActivoId(lote.id);}} className="w-full text-left bg-white border border-gray-200 hover:border-gray-300 rounded-2xl overflow-hidden flex transition-all">
              <div className="w-2 shrink-0" style={{background:tipoColor}}/>
              <div className="flex items-center gap-3 px-4 py-4 flex-1 min-w-0">
                <span className="text-3xl">{tipoIcon}</span>
                <div className="flex-1 min-w-0">
                  <p className="font-black text-gray-900 text-lg leading-tight truncate">{lote.nombre}</p>
                  {lote.tipo!=="agricultura"&&<p className="text-gray-500 text-sm">{animales.length+" animales"+(animales.length>0?" · "+animales.filter(function(a){return a.sexo==="Macho";}).length+"M / "+animales.filter(function(a){return a.sexo==="Hembra";}).length+"H":"")}</p>}
                  {lote.tipo==="agricultura"&&<p className="text-amber-600 text-sm">{(lote.agricultura?lote.agricultura.potreros&&lote.agricultura.potreros.length+" potreros":"0 potreros")}</p>}
                </div>
                <span className="text-gray-400 text-2xl font-bold shrink-0">›</span>
              </div>
            </button>
          );
        })}

        <div className="flex gap-2 pt-2">
          <button onClick={function(){setShowRenombrar(true);}} className="flex-1 text-xs text-gray-600 border border-gray-200 py-2 rounded-xl">✏️ Renombrar</button>
          <button onClick={function(){ask("¿Eliminar "+est.nombre+" y todos sus lotes?",function(){setEstablecimientos(function(prev){return prev.filter(function(e){return e.id!==estId;});});onBack();});}} className="flex-1 text-xs text-red-600 border border-red-900 py-2 rounded-xl">🗑 Eliminar</button>
        </div>
      </main>

      {showNuevoLote&&<NuevoLoteModal onClose={function(){setShowNuevoLote(false);}} onSave={function(nombre,tipo){logCambio("lote_creado","Nuevo lote "+nombre,"Tipo: "+tipo);setLotes(function(prev){return [...prev,{id:Date.now(),nombre,tipo,animales:[],sesiones:[],sesionEnCurso:null,reproSesiones:[],agricultura:{registros:[],gastos:[],potreros:[]}}];});}}/>}
      {showAlertas&&<AlertasModal alertas={alertas} nombreEst={est.nombre} lotes={lotes} onClose={function(){setShowAlertas(false);}} onSave={function(al){setEstablecimientos(function(prev){return prev.map(function(e){return e.id===estId?Object.assign({},e,{alertas:al}):e;});});}}/>}
      {showToros&&<TorosModal est={est} onClose={function(){setShowToros(false);}} onUpdate={function(toros){setEstablecimientos(function(prev){return prev.map(function(e){return e.id===estId?Object.assign({},e,{toros}):e;});});}}/>}
      {showVendidos&&<VendidosModal est={est} onClose={function(){setShowVendidos(false);}} onEliminar={function(animalId){setEstablecimientos(function(prev){return prev.map(function(e){return e.id===estId?Object.assign({},e,{vendidos:(e.vendidos||[]).filter(function(v){return v.id!==animalId;})}):e;});});}}/>}
      {showCuaderno&&<CuadernoModal notas={est.notas||""} onClose={function(){setShowCuaderno(false);}} onSave={function(n){setEstablecimientos(function(prev){return prev.map(function(e){return e.id===estId?Object.assign({},e,{notas:n}):e;});});}}/>}
      {showRenombrar&&<NuevoLoteModal loteEditar={{nombre:est.nombre}} onClose={function(){setShowRenombrar(false);}} onSave={function(nombre){setEstablecimientos(function(prev){return prev.map(function(e){return e.id===estId?Object.assign({},e,{nombre}):e;});});}}/>}
      {confirmDialog}
    </div>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────
// ── Pantalla de Login ─────────────────────────────────────────────────────────
function LoginScreen(){
  var [modo,setModo]=useState("login"); // login | registro | recuperar
  var [email,setEmail]=useState("");
  var [password,setPassword]=useState("");
  var [password2,setPassword2]=useState("");
  var [error,setError]=useState("");
  var [loading,setLoading]=useState(false);
  var [msgExito,setMsgExito]=useState("");

  function traducirError(code){
    if(code==="auth/invalid-email")return "El email no es válido";
    if(code==="auth/user-not-found")return "No hay una cuenta con ese email";
    if(code==="auth/wrong-password"||code==="auth/invalid-credential")return "Email o contraseña incorrectos";
    if(code==="auth/email-already-in-use")return "Ya existe una cuenta con ese email";
    if(code==="auth/weak-password")return "La contraseña es muy débil (mínimo 6 caracteres)";
    if(code==="auth/network-request-failed")return "Sin conexión a internet";
    if(code==="auth/too-many-requests")return "Demasiados intentos. Esperá unos minutos";
    return "Error: "+code;
  }

  async function ingresar(){
    setError("");setMsgExito("");
    if(!email.trim()||!password){setError("Completá email y contraseña");return;}
    setLoading(true);
    try{
      await signInWithEmailAndPassword(auth,email.trim(),password);
    }catch(e){
      setError(traducirError(e.code));
      setLoading(false);
    }
  }

  async function registrar(){
    setError("");setMsgExito("");
    if(!email.trim()||!password){setError("Completá todos los campos");return;}
    if(password.length<6){setError("La contraseña debe tener al menos 6 caracteres");return;}
    if(password!==password2){setError("Las contraseñas no coinciden");return;}
    setLoading(true);
    try{
      await createUserWithEmailAndPassword(auth,email.trim(),password);
    }catch(e){
      setError(traducirError(e.code));
      setLoading(false);
    }
  }

  async function recuperar(){
    setError("");setMsgExito("");
    if(!email.trim()){setError("Ingresá tu email");return;}
    setLoading(true);
    try{
      await sendPasswordResetEmail(auth,email.trim());
      setMsgExito("Te mandamos un email para recuperar tu contraseña. Revisá tu bandeja de entrada.");
      setLoading(false);
    }catch(e){
      setError(traducirError(e.code));
      setLoading(false);
    }
  }

  return(
    <div className="min-h-screen bg-white flex flex-col">
      <div className="max-w-sm w-full mx-auto px-4 pt-16 pb-8 flex flex-col gap-4">
        <div className="text-center mb-4">
          <p className="text-6xl mb-3">🐄</p>
          <h1 className="text-3xl font-black text-gray-900 tracking-tight">Rodeo</h1>
          <p className="text-gray-500 text-sm mt-1">Gestión ganadera y agrícola</p>
        </div>

        <div className="bg-gray-50 border border-gray-200 rounded-2xl p-5 flex flex-col gap-3">
          <h2 className="text-lg font-bold text-gray-900 text-center">
            {modo==="login"?"Iniciar sesión":modo==="registro"?"Crear cuenta":"Recuperar contraseña"}
          </h2>

          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-gray-500 font-bold uppercase">Email</label>
            <input type="email" value={email} onChange={function(e){setEmail(e.target.value);}} placeholder="tu@email.com"
              autoComplete="email" autoCapitalize="none"
              className="bg-white border border-gray-200 rounded-xl px-3 py-3 text-gray-900 text-base focus:outline-none focus:border-gray-900"/>
          </div>

          {modo!=="recuperar"&&(
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-gray-500 font-bold uppercase">Contraseña</label>
              <input type="password" value={password} onChange={function(e){setPassword(e.target.value);}} placeholder="Al menos 6 caracteres"
                className="bg-white border border-gray-200 rounded-xl px-3 py-3 text-gray-900 text-base focus:outline-none focus:border-gray-900"/>
            </div>
          )}

          {modo==="registro"&&(
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-gray-500 font-bold uppercase">Repetir contraseña</label>
              <input type="password" value={password2} onChange={function(e){setPassword2(e.target.value);}}
                className="bg-white border border-gray-200 rounded-xl px-3 py-3 text-gray-900 text-base focus:outline-none focus:border-gray-900"/>
            </div>
          )}

          {error&&<div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-3 py-2 text-sm font-bold">⚠️ {error}</div>}
          {msgExito&&<div className="bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl px-3 py-2 text-sm font-bold">✅ {msgExito}</div>}

          <button onClick={modo==="login"?ingresar:modo==="registro"?registrar:recuperar} disabled={loading}
            style={{boxShadow:"0 1px 3px rgba(0,0,0,0.12)"}}
            className={"w-full font-black py-3 rounded-xl text-base border "+(loading?"bg-gray-300 border-gray-300 text-gray-500":"bg-emerald-500 border-emerald-500 text-white")}>
            {loading?"Procesando...":modo==="login"?"Entrar":modo==="registro"?"Crear cuenta":"Enviar email"}
          </button>

          {modo==="login"&&(
            <>
              <button onClick={function(){setModo("registro");setError("");setMsgExito("");}} className="text-gray-700 text-sm font-bold text-center py-1">
                ¿No tenés cuenta? <span className="text-emerald-600">Registrate</span>
              </button>
              <button onClick={function(){setModo("recuperar");setError("");setMsgExito("");}} className="text-gray-500 text-xs text-center">
                Olvidé mi contraseña
              </button>
            </>
          )}
          {modo==="registro"&&(
            <button onClick={function(){setModo("login");setError("");setMsgExito("");}} className="text-gray-700 text-sm font-bold text-center py-1">
              ¿Ya tenés cuenta? <span className="text-emerald-600">Iniciá sesión</span>
            </button>
          )}
          {modo==="recuperar"&&(
            <button onClick={function(){setModo("login");setError("");setMsgExito("");}} className="text-gray-700 text-sm font-bold text-center py-1">
              ← Volver al login
            </button>
          )}
        </div>

        <p className="text-center text-gray-400 text-xs mt-2">
          Al registrarte, aceptás guardar tus datos de forma segura.
        </p>
      </div>
    </div>
  );
}

// ── App con autenticación ─────────────────────────────────────────────────────
export default function AppConAuth(){
  // auth.currentUser está disponible INMEDIATAMENTE si Firebase ya tiene
  // datos del usuario en IndexedDB (que es el caso cuando ya iniciaste sesión antes).
  // Esto evita la espera bloqueante de onAuthStateChanged cuando no hay internet.
  var [user,setUser]=useState(function(){return auth.currentUser;});
  var [loadingAuth,setLoadingAuth]=useState(function(){return !auth.currentUser;});
  var [syncStatus,setSyncStatus]=useState("idle"); // idle | cargando | listo | error
  var [syncError,setSyncError]=useState("");
  var [syncDoneForUid,setSyncDoneForUid]=useState(null);

  // PWA: registrar service worker y manifest (se ejecuta al abrir la app, antes del login)
  useEffect(function(){
    try{
      var iconSvg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="96" fill="#10b981"/><text x="50%" y="58%" font-size="320" text-anchor="middle" dominant-baseline="middle">🐄</text></svg>';
      var iconUrl="data:image/svg+xml;base64,"+btoa(iconSvg);

      var manifest={
        name:"Rodeo - Gestión Ganadera",
        short_name:"Rodeo",
        description:"Gestión ganadera y agrícola",
        start_url:"/",
        display:"standalone",
        orientation:"portrait",
        background_color:"#ffffff",
        theme_color:"#10b981",
        icons:[
          {src:iconUrl,sizes:"192x192",type:"image/svg+xml",purpose:"any maskable"},
          {src:iconUrl,sizes:"512x512",type:"image/svg+xml",purpose:"any maskable"}
        ]
      };
      var blob=new Blob([JSON.stringify(manifest)],{type:"application/json"});
      var manifestUrl=URL.createObjectURL(blob);

      var linkManifest=document.querySelector('link[rel="manifest"]');
      if(!linkManifest){linkManifest=document.createElement("link");linkManifest.rel="manifest";document.head.appendChild(linkManifest);}
      linkManifest.href=manifestUrl;

      var appleIcon=document.querySelector('link[rel="apple-touch-icon"]');
      if(!appleIcon){appleIcon=document.createElement("link");appleIcon.rel="apple-touch-icon";document.head.appendChild(appleIcon);}
      appleIcon.href=iconUrl;

      var themeColor=document.querySelector('meta[name="theme-color"]');
      if(!themeColor){themeColor=document.createElement("meta");themeColor.name="theme-color";document.head.appendChild(themeColor);}
      themeColor.content="#10b981";

      // Service worker con caché para funcionar offline
      // Se registra desde /sw.js (archivo real en public/) para que pueda interceptar cargas iniciales
      if("serviceWorker" in navigator){
        window.addEventListener("load",function(){
          navigator.serviceWorker.register("/sw.js").catch(function(err){
            console.log("SW registration failed:",err);
          });
        });
      }
    }catch(e){}
  },[]);

  useEffect(function(){
    var unsub=onAuthStateChanged(auth,function(u){
      if(u){
        setUser(u);
        setLoadingAuth(false);
      }else{
        // Si Firebase dice "no hay user" pero estamos offline, ignorar (puede ser transitorio)
        // Solo cerrar sesión si realmente hay conexión y Firebase confirmó el logout
        if(typeof navigator!=="undefined"&&navigator.onLine===false){
          // Offline: mantenemos la sesión como estaba
          setLoadingAuth(false);
          return;
        }
        setUser(null);
        setLoadingAuth(false);
        desactivarSync();
        setSyncStatus("idle");
      }
    });
    return unsub;
  },[]);

  // Cuando el usuario está logueado, cargar datos desde Firestore
  useEffect(function(){
    if(!user)return;
    setSyncError("");
    activarSync(user.uid);
    setSyncStatus("listo");

    var unsubSnapshot=null;
    var ref=refDatosUsuario(user.uid);

    // Estrategia offline-first robusta:
    // - Si estamos ONLINE: usar getDoc (trae del servidor, funciona bien)
    // - Si estamos OFFLINE: usar getDocFromCache (instantáneo, no se cuelga)
    // - Suscribirse a onSnapshot para updates en vivo

    function aplicarDatos(data){
      if(data&&data.establecimientos&&Array.isArray(data.establecimientos)){
        var locales=leerStorage("ganadera_establecimientos_v1",null);
        if(!locales||JSON.stringify(locales)!==JSON.stringify(data.establecimientos)){
          guardarStorage("ganadera_establecimientos_v1",data.establecimientos);
          // Disparar evento custom para que la app actualice el estado sin recargar
          window.dispatchEvent(new CustomEvent("rodeo:datos-actualizados",{detail:data.establecimientos}));
        }
      }
    }

    if(typeof navigator!=="undefined"&&navigator.onLine){
      // Online: traer del servidor
      getDoc(ref).then(function(snap){
        if(snap.exists()){
          aplicarDatos(snap.data());
        }else{
          // No hay datos en servidor, si tengo locales subirlos
          var locales=leerStorage("ganadera_establecimientos_v1",null);
          if(locales&&Array.isArray(locales)&&locales.length>0){
            setDoc(ref,{
              establecimientos:locales,
              actualizado:new Date().toISOString()
            }).catch(function(){});
          }
        }
      }).catch(function(err){
        console.log("getDoc error (intentando cache):",err.message);
        // Si falla online, intentar cache
        getDocFromCache(ref).then(function(snap){
          if(snap.exists())aplicarDatos(snap.data());
        }).catch(function(){});
      });
    }else{
      // Offline: solo cache (instantáneo)
      getDocFromCache(ref).then(function(snap){
        if(snap.exists())aplicarDatos(snap.data());
      }).catch(function(){});
    }

    // Suscribirse para updates en tiempo real
    try{
      unsubSnapshot=onSnapshot(ref,function(snap){
        if(snap.exists()){
          aplicarDatos(snap.data());
        }
      },function(err){
        console.log("onSnapshot error:",err.message);
      });
    }catch(e){console.log("No se pudo suscribir:",e);}

    return function(){
      if(unsubSnapshot)unsubSnapshot();
    };
  },[user]);

  // Desactivar sync al desmontar
  useEffect(function(){
    return function(){desactivarSync();};
  },[]);

  if(loadingAuth){
    return(
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <p className="text-5xl mb-3">🐄</p>
          <p className="text-gray-500 text-sm">Cargando...</p>
        </div>
      </div>
    );
  }

  if(!user)return <LoginScreen/>;

  if(syncStatus==="cargando"){
    return(
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <p className="text-5xl mb-3">🐄</p>
          <p className="text-gray-700 font-bold">Sincronizando tus datos...</p>
          <p className="text-gray-400 text-xs mt-1">Esto puede tardar unos segundos</p>
        </div>
      </div>
    );
  }

  return <AppLogueado user={user} syncError={syncError}/>;
}

// ── App logueada (lo que era antes el App) ────────────────────────────────────
function AppLogueado({user,syncError}){
  useEffect(function(){
    var s=document.createElement("style");
    s.innerHTML=flashStyle;
    document.head.appendChild(s);
    return function(){document.head.removeChild(s);};
  },[]);

  var [establecimientos,setEstablecimientos]=useState(function(){
    var saved=leerStorage("ganadera_establecimientos_v1",null);
    if(saved)return saved;
    var oldLotes=leerStorage("ganadera_lotes_v1",null);
    if(oldLotes){
      return [{id:Date.now(),nombre:"Mi establecimiento",lotes:oldLotes,alertas:[],toros:[],notas:""}];
    }
    return [];
  });
  var [estActivoId,setEstActivoId]=useState(null);
  var [showNuevoEst,setShowNuevoEst]=useState(false);
  var [showBackup,setShowBackup]=useState(false);
  var [showHistCambios,setShowHistCambios]=useState(false);
  var [showMenuUser,setShowMenuUser]=useState(false);
  var [ultBackup,setUltBackup]=useState(function(){return leerStorage("ganadera_ult_backup",null);});
  var [ask,confirmDialog]=useConfirm();

  useEffect(function(){
    guardarStorage("ganadera_establecimientos_v1",establecimientos);
    // Sincronizar a Firestore con debounce
    if(user)sincronizarArriba(user.uid,{establecimientos:establecimientos});
  },[establecimientos,user]);

  // Escuchar actualizaciones desde Firestore (en lugar de hacer reload)
  useEffect(function(){
    function onDatosActualizados(e){
      if(e&&e.detail&&Array.isArray(e.detail)){
        setEstablecimientos(e.detail);
      }
    }
    window.addEventListener("rodeo:datos-actualizados",onDatosActualizados);
    return function(){window.removeEventListener("rodeo:datos-actualizados",onDatosActualizados);};
  },[]);

  // Auto-sincronizar cuando vuelve internet
  useEffect(function(){
    function onlineHandler(){
      if(user&&establecimientos){
        console.log("Volvió internet → sincronizando...");
        sincronizarArriba(user.uid,{establecimientos:establecimientos});
      }
    }
    window.addEventListener("online",onlineHandler);
    return function(){window.removeEventListener("online",onlineHandler);};
  },[user,establecimientos]);

  var estActivo=estActivoId?establecimientos.find(function(e){return e.id===estActivoId;}):null;

  if(estActivo){
    return(
      <VistaEstablecimiento
        estId={estActivoId}
        establecimientos={establecimientos}
        setEstablecimientos={setEstablecimientos}
        onBack={function(){setEstActivoId(null);}}
      />
    );
  }

  return(
    <div className="min-h-screen" style={{background:"#ffffff"}}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600;700;900&display=swap" rel="stylesheet"/>
      <header className="px-4 pt-6 pb-4 border-b border-gray-200">
        <div className="max-w-xl mx-auto flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h1 className="text-3xl font-black text-gray-900 tracking-tight">🐄 Rodeo</h1>
            <p className="text-gray-500 text-xs truncate">{user?user.email:"Gestión ganadera y agrícola"}</p>
          </div>
          <div className="flex gap-2 shrink-0">
            <button onClick={function(){setShowMenuUser(true);}} style={{boxShadow:"0 1px 3px rgba(0,0,0,0.12)"}} className="btn-flash bg-white border border-gray-200 text-gray-700 font-bold px-3 py-3 rounded-xl text-lg" title="Cuenta">👤</button>
            <button onClick={function(){setShowNuevoEst(true);}} style={{boxShadow:"0 1px 3px rgba(0,0,0,0.12)"}} className="btn-flash bg-emerald-300 text-white font-black px-4 py-3 rounded-xl text-sm border border-emerald-300">+ Establecimiento</button>
          </div>
        </div>
      </header>

      <main className="max-w-xl mx-auto px-4 py-4 flex flex-col gap-3">
        {establecimientos.length===0&&(
          <div className="flex flex-col gap-4 py-8">
            <div className="text-center">
              <p className="text-6xl mb-3">🐄</p>
              <p className="text-2xl font-black text-gray-800 mb-1">¡Bienvenido a Rodeo!</p>
              <p className="text-sm text-gray-500">La app para gestionar tu campo</p>
            </div>

            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 flex flex-col gap-3">
              <p className="text-emerald-800 font-bold text-sm">📝 Cómo empezar:</p>
              <div className="flex items-start gap-3">
                <div className="bg-emerald-300 text-white rounded-full w-7 h-7 flex items-center justify-center font-black text-sm shrink-0">1</div>
                <div>
                  <p className="text-gray-900 font-bold text-sm">Creá tu primer establecimiento</p>
                  <p className="text-gray-600 text-xs">Es donde se guardan tus campos. Tocá <b>"+ Establecimiento"</b> arriba</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="bg-emerald-300 text-white rounded-full w-7 h-7 flex items-center justify-center font-black text-sm shrink-0">2</div>
                <div>
                  <p className="text-gray-900 font-bold text-sm">Agregá un lote</p>
                  <p className="text-gray-600 text-xs">Los lotes son grupos de animales (ej: Vaquillonas, Toros, Engorde)</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="bg-emerald-300 text-white rounded-full w-7 h-7 flex items-center justify-center font-black text-sm shrink-0">3</div>
                <div>
                  <p className="text-gray-900 font-bold text-sm">Cargá tus animales</p>
                  <p className="text-gray-600 text-xs">Y empezá a registrar pesajes, sanidad, reproducción y más</p>
                </div>
              </div>
            </div>

            <div className="bg-gray-50 border border-gray-200 rounded-xl p-3">
              <p className="text-gray-700 text-xs"><b>💡 Tip:</b> Tus datos se guardan en la nube automáticamente. Podés acceder desde cualquier celular con tu cuenta.</p>
            </div>
          </div>
        )}

        {/* Banner de error de sync */}
        {syncError&&(
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 flex items-start gap-2">
            <span className="text-xl">⚠️</span>
            <div className="flex-1">
              <p className="text-amber-800 font-bold text-sm">Sin conexión a la nube</p>
              <p className="text-amber-700 text-xs">Podés seguir usando la app normal. Los cambios se sincronizarán cuando vuelva la conexión.</p>
            </div>
          </div>
        )}

        {/* Banner de alertas pendientes - resumen global */}
        {(function(){
          var estsConAlertas=establecimientos.filter(function(e){
            return (e.alertas||[]).some(function(a){var es=estadoAlerta(a.fechaHora,a.pasada);return es==="urgente"||es==="pronto";});
          });
          if(estsConAlertas.length===0)return null;
          var totalActivas=estsConAlertas.reduce(function(s,e){return s+(e.alertas||[]).filter(function(a){var es=estadoAlerta(a.fechaHora,a.pasada);return es==="urgente"||es==="pronto";}).length;},0);
          return(
            <div className="bg-amber-50 border border-amber-300 rounded-2xl px-4 py-3 flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <span className="text-2xl">🔔</span>
                <p className="text-amber-900 font-black text-sm">{totalActivas+" alerta"+(totalActivas>1?"s":"")+" pendiente"+(totalActivas>1?"s":"")}</p>
              </div>
              <div className="flex flex-col gap-1">
                {estsConAlertas.map(function(e){
                  var cant=(e.alertas||[]).filter(function(a){var es=estadoAlerta(a.fechaHora,a.pasada);return es==="urgente"||es==="pronto";}).length;
                  return(
                    <button key={e.id} onClick={function(){setEstActivoId(e.id);}} className="text-left bg-white border border-amber-200 rounded-xl px-3 py-2 flex items-center justify-between">
                      <p className="text-amber-800 text-sm font-bold">{e.nombre}</p>
                      <span className="text-xs text-amber-700 font-bold">{cant+" →"}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* Recordatorio de backup */}
        {establecimientos.length>0&&(function(){
          var diasDesde=null;
          if(ultBackup){
            diasDesde=Math.floor((new Date()-new Date(ultBackup))/86400000);
          }
          if(!ultBackup||diasDesde>=7){
            return(
              <button onClick={function(){setShowBackup(true);}} className="w-full text-left bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center gap-3">
                <span className="text-2xl">💾</span>
                <div className="flex-1 min-w-0">
                  <p className="text-amber-800 font-bold text-sm">{!ultBackup?"Nunca hiciste un backup":"Hace "+diasDesde+" días sin backup"}</p>
                  <p className="text-amber-600 text-xs">Tocá para hacer uno ahora</p>
                </div>
                <span className="text-amber-600 text-xl">›</span>
              </button>
            );
          }
          return null;
        })()}

        {establecimientos.map(function(est){
          var totalAnimales=(est.lotes||[]).reduce(function(s,l){return s+(l.animales||[]).length;},0);
          var alertasAct=(est.alertas||[]).filter(function(a){var e2=estadoAlerta(a.fechaHora,a.pasada);return e2==="urgente"||e2==="pronto";});
          return(
            <button key={est.id} onClick={function(){setEstActivoId(est.id);}} className="w-full text-left bg-white border border-gray-200 hover:border-gray-300 rounded-2xl overflow-hidden flex transition-all">
              <div className="w-2 shrink-0 bg-emerald-600"/>
              <div className="flex items-center gap-4 px-4 py-4 flex-1 min-w-0">
                <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <rect width="48" height="48" rx="14" fill="#d4eaff"/>
                  {/* Cielo */}
                  <rect x="0" y="0" width="48" height="30" rx="14" fill="#87ceeb"/>
                  {/* Pasto */}
                  <rect x="0" y="30" width="48" height="18" fill="#4aaa20"/>
                  <rect x="0" y="42" width="48" height="6" rx="0" fill="#3a8a18"/>
                  {/* Árboles altos (cipreses) */}
                  <ellipse cx="10" cy="18" rx="3" ry="10" fill="#1a5a10"/>
                  <ellipse cx="16" cy="16" rx="3" ry="12" fill="#1a6a10"/>
                  <ellipse cx="22" cy="17" rx="2.5" ry="11" fill="#1a5a10"/>
                  {/* Casa - pared */}
                  <rect x="4" y="26" width="40" height="14" rx="1" fill="#f0ede0"/>
                  {/* Casa - techo verde */}
                  <path d="M3 27 L24 20 L45 27Z" fill="#2a6a18"/>
                  {/* Ventanas */}
                  <rect x="7" y="28" width="5" height="5" rx="0.5" fill="#8ab0d0"/>
                  <rect x="15" y="28" width="5" height="5" rx="0.5" fill="#8ab0d0"/>
                  <rect x="33" y="28" width="5" height="5" rx="0.5" fill="#8ab0d0"/>
                  {/* Puerta */}
                  <rect x="23" y="29" width="5" height="11" rx="0.5" fill="#8a6030"/>
                </svg>
                <div className="flex-1 min-w-0">
                  <p className="font-black text-gray-900 text-xl leading-tight">{est.nombre}</p>
                  <p className="text-gray-500 text-sm">{(est.lotes||[]).length+" lotes · "+totalAnimales+" animales"}</p>
                  {alertasAct.length>0&&<p className="text-amber-400 text-xs font-bold mt-0.5">{"🔔 "+alertasAct.length+" alerta"+(alertasAct.length>1?"s":"")}</p>}
                </div>
                <span className="text-gray-400 text-2xl font-bold shrink-0">›</span>
              </div>
            </button>
          );
        })}
      </main>

      {showNuevoEst&&(
        <Modal title="🌾 Nuevo establecimiento" onClose={function(){setShowNuevoEst(false);}}>
          <NuevoEstForm onSave={function(nombre){logCambio("est_creado","Nuevo establecimiento "+nombre,"");setEstablecimientos(function(prev){return [...prev,{id:Date.now(),nombre,lotes:[],alertas:[],toros:[],notas:""}];});setShowNuevoEst(false);}} onClose={function(){setShowNuevoEst(false);}}/>
        </Modal>
      )}
      {showBackup&&<BackupModal establecimientos={establecimientos} setEstablecimientos={setEstablecimientos} onBackupDone={function(){var f=new Date().toISOString();guardarStorage("ganadera_ult_backup",f);setUltBackup(f);}} onClose={function(){setShowBackup(false);}}/>}
      {showHistCambios&&<HistorialCambiosModal onClose={function(){setShowHistCambios(false);}}/>}
      {showMenuUser&&(
        <Modal title="👤 Mi cuenta" onClose={function(){setShowMenuUser(false);}}>
          <div className="flex flex-col gap-3">
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-3">
              <p className="text-[10px] text-gray-500 uppercase font-bold">Sesión iniciada como</p>
              <p className="text-gray-900 font-bold text-sm break-all">{user?user.email:""}</p>
            </div>

            <button onClick={function(){setShowMenuUser(false);setShowBackup(true);}} className="w-full text-left bg-white border border-gray-200 rounded-xl px-4 py-3 flex items-center gap-3">
              <span className="text-2xl">💾</span>
              <div className="flex-1">
                <p className="text-gray-900 font-bold text-sm">Backup / Restaurar</p>
                <p className="text-gray-500 text-xs">Exportar o importar tus datos</p>
              </div>
              <span className="text-gray-400 text-xl">›</span>
            </button>

            <button onClick={function(){setShowMenuUser(false);setShowHistCambios(true);}} className="w-full text-left bg-white border border-gray-200 rounded-xl px-4 py-3 flex items-center gap-3">
              <span className="text-2xl">📜</span>
              <div className="flex-1">
                <p className="text-gray-900 font-bold text-sm">Historial de cambios</p>
                <p className="text-gray-500 text-xs">Ver qué hiciste en la app</p>
              </div>
              <span className="text-gray-400 text-xl">›</span>
            </button>

            <button onClick={function(){
              if(confirm("¿Cerrar sesión?\n\nTus datos están en la nube, no se pierden. Al volver a entrar con tu email los vas a ver.")){
                desactivarSync();
                // Limpiar datos locales para que el próximo usuario no los vea
                try{localStorage.removeItem("ganadera_establecimientos_v1");}catch(e){}
                signOut(auth);
                setShowMenuUser(false);
              }
            }} className="w-full text-left bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-center gap-3 mt-2">
              <span className="text-2xl">🚪</span>
              <div className="flex-1">
                <p className="text-red-700 font-bold text-sm">Cerrar sesión</p>
                <p className="text-red-500 text-xs">Salir de tu cuenta</p>
              </div>
            </button>
          </div>
        </Modal>
      )}
      {confirmDialog}
    </div>
  );
}

function NuevoEstForm({onSave,onClose}){
  var [nombre,setNombre]=useState("");
  var ref=useRef();
  useEffect(function(){if(ref.current)ref.current.focus();},[]);
  return(
    <div className="flex flex-col gap-3">
      <Inp label="Nombre del establecimiento" value={nombre} onChange={function(e){setNombre(e.target.value);}} inputRef={ref} placeholder="Ej: La Esperanza, Campo Norte..."/>
      <button onClick={function(){if(!nombre.trim())return;onSave(nombre.trim());}} style={{boxShadow:"0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.08)"}} className="w-full bg-emerald-600 text-white font-black py-3 rounded-xl border border-emerald-500">Crear</button>
    </div>
  );
}

// ── Backup Modal ──────────────────────────────────────────────────────────────
function BackupModal({establecimientos,setEstablecimientos,onBackupDone,onClose}){
  var [ask,confirmDialog]=useConfirm();
  var [copiado,setCopiado]=useState(false);
  var [modo,setModo]=useState("menu"); // menu | exportar | importar
  var [textoImport,setTextoImport]=useState("");
  var [errorImport,setErrorImport]=useState("");

  // Stats para mostrar qué hay
  var totalAnimales=establecimientos.reduce(function(s,e){
    return s+(e.lotes||[]).reduce(function(s2,l){return s2+(l.animales||[]).length;},0);
  },0);
  var totalLotes=establecimientos.reduce(function(s,e){return s+(e.lotes||[]).length;},0);

  var backupData={
    version:1,
    fecha:new Date().toISOString(),
    establecimientos:establecimientos
  };
  var backupStr=JSON.stringify(backupData);

  function marcarHecho(){if(onBackupDone)onBackupDone();}

  function descargar(){
    var hoyStr=new Date().toISOString().split("T")[0];
    var blob=new Blob([JSON.stringify(backupData,null,2)],{type:"application/json"});
    var url=URL.createObjectURL(blob);
    var a=document.createElement("a");
    a.href=url;
    a.download="rodeo-backup-"+hoyStr+".json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    marcarHecho();
  }

  function copiar(){
    if(navigator.clipboard){
      navigator.clipboard.writeText(backupStr).then(function(){
        setCopiado(true);
        marcarHecho();
        setTimeout(function(){setCopiado(false);},2000);
      });
    }
  }

  function compartirWhatsApp(){
    // WhatsApp tiene límite de caracteres, advertimos si es muy largo
    if(backupStr.length>30000){
      alert("El backup es muy grande para WhatsApp. Mejor usá 'Descargar archivo' y compartilo desde ahí.");
      return;
    }
    var txt="Backup Rodeo "+new Date().toLocaleDateString("es-AR")+"\n\n"+backupStr;
    var url="https://wa.me/?text="+encodeURIComponent(txt);
    window.open(url,"_blank");
    marcarHecho();
  }

  function importar(){
    setErrorImport("");
    if(!textoImport.trim()){setErrorImport("Pegá el backup primero");return;}
    try{
      var data=JSON.parse(textoImport.trim());
      var ests;
      // Aceptar tanto objeto con version como array directo
      if(Array.isArray(data))ests=data;
      else if(data.establecimientos&&Array.isArray(data.establecimientos))ests=data.establecimientos;
      else{setErrorImport("Formato inválido");return;}

      if(ests.length===0){setErrorImport("El backup está vacío");return;}
      // Validación mínima
      var ok=ests.every(function(e){return e&&typeof e.nombre==="string";});
      if(!ok){setErrorImport("Formato inválido");return;}

      var cuantosAnim=ests.reduce(function(s,e){return s+(e.lotes||[]).reduce(function(s2,l){return s2+(l.animales||[]).length;},0);},0);

      ask("⚠️ Esto va a reemplazar TODOS tus datos actuales con "+ests.length+" establecimientos, "+cuantosAnim+" animales. ¿Continuar?",function(){
        setEstablecimientos(ests);
        setTextoImport("");
        setModo("menu");
        setTimeout(function(){alert("✅ Backup restaurado correctamente");},100);
      });
    }catch(e){
      setErrorImport("No se pudo leer el texto. ¿Pegaste el backup completo?");
    }
  }

  async function pegarDelPortapapeles(){
    try{
      if(navigator.clipboard&&navigator.clipboard.readText){
        var txt=await navigator.clipboard.readText();
        setTextoImport(txt);
      }
    }catch(e){}
  }

  if(modo==="menu"){
    return(
      <Modal title="💾 Backup y Restaurar" onClose={onClose}>
        <div className="flex flex-col gap-3">
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 flex flex-col gap-1">
            <p className="text-[10px] text-gray-500 uppercase font-bold">Datos actuales</p>
            <p className="text-gray-900 font-bold text-sm">{establecimientos.length+" establecimientos · "+totalLotes+" lotes · "+totalAnimales+" animales"}</p>
          </div>

          <button onClick={function(){setModo("exportar");}} className="w-full bg-emerald-300 text-white font-black py-4 rounded-xl text-base border border-emerald-300" style={{boxShadow:"0 1px 3px rgba(0,0,0,0.12)"}}>
            📤 Exportar backup
          </button>
          <p className="text-xs text-gray-500 -mt-1 px-1">Guardá una copia de toda tu data</p>

          <button onClick={function(){setModo("importar");}} className="w-full bg-white border border-gray-300 text-gray-800 font-black py-4 rounded-xl text-base" style={{boxShadow:"0 1px 3px rgba(0,0,0,0.12)"}}>
            📥 Restaurar backup
          </button>
          <p className="text-xs text-gray-500 -mt-1 px-1">Cargar datos desde un backup anterior</p>
        </div>
      </Modal>
    );
  }

  if(modo==="exportar"){
    return(
      <Modal title="📤 Exportar backup" onClose={onClose}>
        <div className="flex flex-col gap-3">
          <button onClick={function(){setModo("menu");}} className="self-start text-gray-600 text-sm font-bold">← Volver</button>

          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3">
            <p className="text-emerald-800 text-sm font-bold">✓ Backup listo</p>
            <p className="text-emerald-700 text-xs mt-0.5">{establecimientos.length+" establecimientos · "+totalAnimales+" animales"}</p>
          </div>

          <button onClick={descargar} className="w-full bg-emerald-500 text-white font-black py-3 rounded-xl text-base border border-emerald-500" style={{boxShadow:"0 1px 3px rgba(0,0,0,0.12)"}}>
            💾 Descargar archivo
          </button>
          <p className="text-xs text-gray-500 -mt-2 px-1">Guardá el archivo en tu celular o Google Drive</p>

          <button onClick={compartirWhatsApp} className="w-full bg-white border border-gray-300 text-gray-800 font-bold py-3 rounded-xl text-sm">
            📱 Compartir por WhatsApp
          </button>

          <button onClick={copiar} className={"w-full font-bold py-3 rounded-xl text-sm border "+(copiado?"bg-emerald-600 border-emerald-600 text-white":"bg-white border-gray-300 text-gray-800")}>
            {copiado?"✓ Copiado!":"📋 Copiar al portapapeles"}
          </button>

          <div className="border-t border-gray-100 pt-3">
            <p className="text-[10px] text-gray-500 uppercase font-bold mb-1">Texto del backup (opcional)</p>
            <textarea readOnly value={backupStr} rows={4} className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-gray-700 text-[10px] font-mono focus:outline-none resize-none"/>
          </div>
        </div>
      </Modal>
    );
  }

  if(modo==="importar"){
    return(
      <Modal title="📥 Restaurar backup" onClose={onClose}>
        <div className="flex flex-col gap-3">
          <button onClick={function(){setModo("menu");}} className="self-start text-gray-600 text-sm font-bold">← Volver</button>

          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
            <p className="text-amber-800 text-sm font-bold">⚠️ Atención</p>
            <p className="text-amber-700 text-xs mt-0.5">Restaurar va a reemplazar TODOS tus datos actuales. Si querés, exportá primero un backup de lo que tenés ahora.</p>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-gray-500 font-bold uppercase">Pegá acá el texto del backup</label>
            <textarea value={textoImport} onChange={function(e){setTextoImport(e.target.value);setErrorImport("");}} rows={6} placeholder='{"version":1,"fecha":"...","establecimientos":[...]}'
              className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-gray-700 text-xs font-mono focus:outline-none focus:border-gray-900 resize-none placeholder-gray-400"/>
          </div>

          <button onClick={pegarDelPortapapeles} className="w-full bg-white border border-gray-300 text-gray-800 font-bold py-2 rounded-xl text-sm">
            📋 Pegar desde portapapeles
          </button>

          {errorImport&&<p className="text-red-600 text-sm font-bold">⚠️ {errorImport}</p>}

          <button onClick={importar} disabled={!textoImport.trim()} className={"w-full font-black py-3 rounded-xl text-base border "+(textoImport.trim()?"bg-emerald-500 border-emerald-500 text-white":"bg-gray-100 border-gray-200 text-gray-400")} style={textoImport.trim()?{boxShadow:"0 1px 3px rgba(0,0,0,0.12)"}:{}}>
            ✓ Restaurar datos
          </button>

          {confirmDialog}
        </div>
      </Modal>
    );
  }

  return null;
}

// ── Historial de Cambios Modal ────────────────────────────────────────────────
function HistorialCambiosModal({onClose}){
  var [ask,confirmDialog]=useConfirm();
  var [logs,setLogs]=useState(function(){return leerStorage("ganadera_cambios_v1",[]);});
  var [filtro,setFiltro]=useState("");

  var tiposLabels={
    animal_creado:"🐄 Animal creado",
    lote_creado:"📁 Lote creado",
    est_creado:"🏡 Establecimiento creado",
    sesion_pesaje:"⚖️ Sesión pesaje",
    animales_movidos:"🔀 Animales movidos",
    otro:"📝 Otro"
  };

  function iconoTipo(t){
    if(t==="animal_creado")return "🐄";
    if(t==="lote_creado")return "📁";
    if(t==="est_creado")return "🏡";
    if(t==="sesion_pesaje")return "⚖️";
    if(t==="animales_movidos")return "🔀";
    return "📝";
  }

  function colorTipo(t){
    if(t==="animal_creado")return "bg-emerald-50 border-emerald-200";
    if(t==="lote_creado")return "bg-blue-50 border-blue-200";
    if(t==="est_creado")return "bg-purple-50 border-purple-200";
    if(t==="sesion_pesaje")return "bg-sky-50 border-sky-200";
    if(t==="animales_movidos")return "bg-amber-50 border-amber-200";
    return "bg-gray-50 border-gray-200";
  }

  function tiempoRelativo(iso){
    var diff=(new Date()-new Date(iso))/1000;
    if(diff<60)return "hace unos segundos";
    if(diff<3600)return "hace "+Math.floor(diff/60)+" min";
    if(diff<86400)return "hace "+Math.floor(diff/3600)+" h";
    var dias=Math.floor(diff/86400);
    if(dias===1)return "ayer";
    if(dias<30)return "hace "+dias+" días";
    return new Date(iso).toLocaleDateString("es-AR");
  }

  var filtrados=filtro?logs.filter(function(l){return l.tipo===filtro;}):logs;

  return(
    <Modal title="📜 Historial de cambios" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <p className="text-xs text-gray-500">Últimos {logs.length} cambios registrados</p>

        {logs.length>0&&(
          <div className="flex gap-1 flex-wrap">
            <button onClick={function(){setFiltro("");}} className={"px-3 py-1.5 rounded-lg text-xs font-bold border "+(filtro===""?"bg-gray-900 border-gray-900 text-white":"bg-white border-gray-200 text-gray-600")}>Todos</button>
            {Object.keys(tiposLabels).filter(function(t){return logs.some(function(l){return l.tipo===t;});}).map(function(t){
              return <button key={t} onClick={function(){setFiltro(t);}} className={"px-3 py-1.5 rounded-lg text-xs font-bold border "+(filtro===t?"bg-gray-900 border-gray-900 text-white":"bg-white border-gray-200 text-gray-600")}>{tiposLabels[t]}</button>;
            })}
          </div>
        )}

        {logs.length>0&&(
          <button onClick={function(){ask("¿Borrar todo el historial de cambios?",function(){guardarStorage("ganadera_cambios_v1",[]);setLogs([]);});}} className="self-start text-xs text-red-600 border border-red-200 bg-red-50 px-3 py-1.5 rounded-lg">🗑 Borrar historial</button>
        )}

        {filtrados.length===0&&(
          <div className="text-center py-10 text-gray-400">
            <p className="text-4xl mb-2">📜</p>
            <p className="text-sm">Sin cambios registrados aún</p>
          </div>
        )}

        <div className="flex flex-col gap-1.5 max-h-96 overflow-y-auto">
          {filtrados.map(function(l){
            return(
              <div key={l.id} className={"rounded-xl px-3 py-2 border "+colorTipo(l.tipo)}>
                <div className="flex items-start gap-2">
                  <span className="text-xl shrink-0">{iconoTipo(l.tipo)}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-gray-900 font-bold text-sm">{l.texto}</p>
                    {l.detalle&&<p className="text-gray-600 text-xs">{l.detalle}</p>}
                    <p className="text-gray-400 text-[10px] mt-0.5">{tiempoRelativo(l.fecha)}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        {confirmDialog}
      </div>
    </Modal>
  );
}
