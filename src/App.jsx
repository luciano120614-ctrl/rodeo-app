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
  return [...pesajes].sort(function(a,b){return new Date(b.fecha)-new Date(a.fecha);})[0].peso;
}
function sumarDias(fecha,dias){
  var d=new Date(fecha+"T12:00:00");
  d.setDate(d.getDate()+dias);
  return d.toISOString().split("T")[0];
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
        <Inp label="Fecha de nac. (opcional)" type="date" value={f.fechaNac} onChange={function(e){set("fechaNac",e.target.value);}}/>
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
function DetalleModal({animal,onClose,onUpdate,onDelete,lotes,loteActualId,establecimientos,estId,onMoverEst}){
  var [tab,setTab]=useState("info");
  var [obs,setObs]=useState(animal.obs||"");
  var [peso,setPeso]=useState("");
  var [fecha,setFecha]=useState(hoy());
  var [showMover,setShowMover]=useState(false);
  var [loteDestino,setLoteDestino]=useState("");
  var [showMoverEst,setShowMoverEst]=useState(false);
  var [estDestino,setEstDestino]=useState("");
  var [loteEnEst,setLoteEnEst]=useState("");
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
        {["info","pesajes","sanidad"].map(function(t){
          return(
            <button key={t} onClick={function(){setTab(t);}}
              className={"flex-1 py-2.5 rounded-xl text-xs font-bold tracking-wider transition-all "+(tab===t?"bg-white text-gray-900 shadow-sm":"text-gray-500")}>
              {t==="info"?"📋 Info":t==="pesajes"?"⚖️ Pesajes":"💉 Sanidad"}
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
            <button onClick={function(){ask("¿Eliminar este animal?",function(){onDelete(animal.id);onClose();});}} className="self-start text-xs text-red-400 border border-red-700 px-3 py-1.5 rounded-lg">🗑 Eliminar</button>
          </div>
        </div>
      )}

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
    var np={id:Date.now(),peso:parseFloat(peso),fecha};
    var animalAct=Object.assign({},encontrado,{pesajes:[...(encontrado.pesajes||[]),np]});
    setLotes(function(prev){
      return prev.map(function(l){
        if(l.id!==loteId)return l;
        return Object.assign({},l,{animales:l.animales.map(function(a){return a.id===animalAct.id?animalAct:a;})});
      });
    });
    var ga=gdpTotal(animalAct.pesajes);
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
    // Actualizar log
    setLog(function(prev){return prev.map(function(x){
      if(x.id!==r.id)return x;
      // Recalcular kg ganados usando el animal original
      var anim=animalesActuales.find(function(a){return a.caravana===r.caravana;});
      var pesajesAnt=anim?(anim.pesajes||[]).filter(function(p){return p.fecha!==fecha;}):[];
      var upAnt=pesajesAnt.length>0?[...pesajesAnt].sort(function(a,b){return new Date(b.fecha)-new Date(a.fecha);})[0].peso:null;
      var kgGan=upAnt!==null?parseFloat((nuevoPeso-upAnt).toFixed(1)):null;
      return Object.assign({},x,{peso:nuevoPeso,kgGanados:kgGan});
    });});
    // Actualizar el pesaje en el animal (en el lote)
    setLotes(function(prev){
      return prev.map(function(l){
        if(l.id!==loteId)return l;
        return Object.assign({},l,{animales:l.animales.map(function(a){
          if(a.caravana!==r.caravana)return a;
          return Object.assign({},a,{pesajes:(a.pesajes||[]).map(function(p){
            if(p.fecha===fecha)return Object.assign({},p,{peso:nuevoPeso});
            return p;
          })});
        })});
      });
    });
    setEditandoId(null);
    setPesoEdit("");
  }

  function eliminarDelLog(r){
    setLog(function(prev){return prev.filter(function(x){return x.id!==r.id;});});
    // Eliminar el pesaje del animal
    setLotes(function(prev){
      return prev.map(function(l){
        if(l.id!==loteId)return l;
        return Object.assign({},l,{animales:l.animales.map(function(a){
          if(a.caravana!==r.caravana)return a;
          return Object.assign({},a,{pesajes:(a.pesajes||[]).filter(function(p){return p.fecha!==fecha;})});
        })});
      });
    });
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
  var sorted=[...sesiones].sort(function(a,b){return b.fecha.localeCompare(a.fecha);});

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

        {sorted.length===0&&<p className="text-gray-400 text-center py-8">Sin sesiones guardadas</p>}
        {sorted.map(function(s){
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

// ── Repro Modal ───────────────────────────────────────────────────────────────
function ReproModal({lote,onClose,onUpdate,toros}){
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
          {sesionActual&&log.length>0&&(
            <div className="bg-amber-950/30 border border-amber-700 rounded-xl px-4 py-3">
              <p className="text-amber-300 font-bold text-sm">{"⏸ Sesión pausada · "+(sesionActual.tipo==="tacto"?"Tacto":sesionActual.tipo==="servicio"?"Servicio":"Partos")}</p>
              <p className="text-amber-600 text-xs">{log.length+" registros"}</p>
              <div className="flex gap-2 mt-2">
                <button onClick={function(){setModo("manga");}} style={{boxShadow:"0 1px 2px rgba(0,0,0,0.1)"}} className="flex-1 bg-amber-700 text-white font-bold py-2 rounded-xl text-sm border border-amber-500">▶ Retomar</button>
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
              {[...sesiones].sort(function(a,b){return b.fecha.localeCompare(a.fecha);}).map(function(s){
                return(
                  <button key={s.id} onClick={function(){setSesionActual(Object.assign({},s,{soloVer:true}));setLog(s.registros);setModo("resumen");}}
                    className="w-full text-left bg-pink-50 border border-pink-200 rounded-xl px-4 py-3 flex items-center justify-between">
                    <div>
                      <p className="text-white font-black text-sm">{fmtFecha(s.fecha)+" · "+(s.tipo==="tacto"?"Tacto":s.tipo==="servicio"?"Servicio":"Partos")}</p>
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
    return(
      <Modal title={"📋 "+tipoLbl+" · "+fmtFecha(sesionActual.fecha)} onClose={function(){if(sesionActual.soloVer){setSesionActual(null);setLog([]);}setModo("menu");}}>
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-2">
            <div style={{background:"#fdf2f8"}} className=" border border-pink-200 rounded-xl p-3 text-center">
              <p className="text-2xl font-black text-white">{log.length}</p>
              <p className="text-[10px] text-pink-600 uppercase mt-1">Animales</p>
            </div>
            {sesionActual.tipo==="tacto"&&(
              <div style={{background:"#fdf2f8"}} className=" border border-pink-200 rounded-xl p-3 text-center">
                <p className="text-2xl font-black text-green-300">{log.filter(function(r){return r.resultado==="Preñada";}).length}</p>
                <p className="text-[10px] text-pink-600 uppercase mt-1">Preñadas</p>
              </div>
            )}
            {sesionActual.tipo==="parto"&&(
              <div style={{background:"#fdf2f8"}} className=" border border-pink-200 rounded-xl p-3 text-center">
                <p className="text-2xl font-black text-green-300">{log.filter(function(r){return r.vivo;}).length}</p>
                <p className="text-[10px] text-pink-600 uppercase mt-1">Vivos</p>
              </div>
            )}
          </div>
          <div className="flex flex-col gap-1.5 max-h-64 overflow-y-auto">
            {log.map(function(r){
              return(
                <div key={r.id} className="flex items-center justify-between bg-pink-50 border border-pink-200 rounded-xl px-3 py-2">
                  <div>
                    <p className="text-white font-bold text-sm">{r.caravana}</p>
                    <p className="text-pink-500 text-xs">{r.categoria}</p>
                  </div>
                  <div className="text-right">
                    {r.resultado&&<p className={"text-sm font-bold "+(r.resultado==="Preñada"?"text-green-300":r.resultado==="Vacía"?"text-red-300":"text-amber-300")}>{r.resultado}</p>}
                    {r.tipo&&<p className="text-pink-600 text-sm">{r.tipo+(r.toro&&r.toro!=="__otro"?" · "+r.toro:"")}</p>}
                    {r.fechaPartoProbable&&<p className="text-amber-400 text-xs">{"🐄 Parto est.: "+fmtFecha(r.fechaPartoProbable)}</p>}
                    {r.vivo!==undefined&&<p className={"text-sm font-bold "+(r.vivo?"text-green-300":"text-red-300")}>{r.vivo?"Vivo":"Muerto"}</p>}
                    {r.obs&&<p className="text-pink-500 text-xs">{r.obs}</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </Modal>
    );
  }
  return null;
}

// ── Toros Modal ───────────────────────────────────────────────────────────────
function TorosModal({est,onClose,onUpdate}){
  var [ask,confirmDialog]=useConfirm();
  var [form,setForm]=useState({caravana:"",raza:"",obs:""});
  var toros=est.toros||[];
  function setF(k,v){setForm(function(p){return Object.assign({},p,{[k]:v});});}
  function guardar(){
    if(!form.caravana.trim())return;
    onUpdate([...toros,{id:Date.now(),caravana:form.caravana.trim().toUpperCase(),raza:form.raza,obs:form.obs}]);
    setForm({caravana:"",raza:"",obs:""});
  }
  return(
    <Modal title="🐂 Toros" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 flex flex-col gap-2">
          <p className="text-xs font-black text-green-600 uppercase">+ Nuevo toro</p>
          <div className="grid grid-cols-2 gap-2">
            <Inp label="Caravana" placeholder="N° caravana" value={form.caravana} onChange={function(e){setF("caravana",e.target.value);}}/>
            <Sel label="Raza" options={RAZAS} value={form.raza} onChange={function(e){setF("raza",e.target.value);}}/>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-green-600 font-bold uppercase">Observaciones</label>
            <textarea rows={2} value={form.obs} onChange={function(e){setF("obs",e.target.value);}} placeholder="Características..."
              className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-gray-800 text-sm focus:outline-none focus:border-green-400 resize-none"/>
          </div>
          <button onClick={guardar} style={{boxShadow:"0 1px 2px rgba(0,0,0,0.1)"}} className="w-full bg-emerald-600 text-gray-900 font-bold py-2.5 rounded-xl text-sm border border-emerald-500">Guardar Toro</button>
        </div>
        {toros.length===0&&<div className="text-center py-8 text-gray-400"><p className="text-4xl mb-2">🐂</p><p className="text-sm">Sin toros</p></div>}
        {toros.map(function(t){
          return(
            <div key={t.id} className="bg-gray-50 border border-gray-100 rounded-xl px-4 py-3 flex items-start justify-between">
              <div>
                <p className="text-gray-800 font-black text-base">{t.caravana}</p>
                {t.raza&&<p className="text-green-600 text-xs">{t.raza}</p>}
                {t.obs&&<p className="text-gray-900 text-sm mt-0.5">{t.obs}</p>}
              </div>
              <button onClick={function(){ask("¿Eliminar toro?",function(){onUpdate(toros.filter(function(x){return x.id!==t.id;}));});}} className="text-red-500 text-lg ml-2">✕</button>
            </div>
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
        {sorted.length===0&&<p className="text-gray-400 text-center py-6">Sin alertas</p>}
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
              {registros.filter(function(r){return r.potrero===potreroActivo.nombre;}).length===0&&<p className="text-gray-400 text-sm text-center py-4">Sin actividades</p>}
              {[...registros].filter(function(r){return r.potrero===potreroActivo.nombre;}).sort(function(a,b){return b.fecha.localeCompare(a.fecha);}).map(function(r){
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
            {registros.length===0&&<p className="text-gray-400 text-sm text-center py-4">Sin actividades</p>}
            {[...registros].sort(function(a,b){return b.fecha.localeCompare(a.fecha);}).map(function(r){
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
          <div style={{background:"#fffbeb"}} className=" border border-amber-200 rounded-xl p-3 text-center">
            <p className="text-[10px] text-amber-600 uppercase font-bold">Total gastos</p>
            <p className="text-2xl font-black text-amber-700">{"$"+gastos.reduce(function(s,g){return s+g.monto;},0).toLocaleString("es-AR")}</p>
          </div>
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
            {gastos.length===0&&<p className="text-gray-400 text-sm text-center py-4">Sin gastos</p>}
            {[...gastos].sort(function(a,b){return b.fecha.localeCompare(a.fecha);}).map(function(g){
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
    setLotes(function(prev){return prev.map(function(l){return l.id===loteId?Object.assign({},l,{animales:[...l.animales,a]}):l;});});
  }
  function actualizar(a){
    setLotes(function(prev){
      return prev.map(function(l){
        if(l.id===loteId)return Object.assign({},l,{animales:l.animales.map(function(x){return x.id===a.id?a:x;})});
        if(a._moverA&&l.id===parseInt(a._moverA)){var clean=Object.assign({},a);delete clean._moverA;return Object.assign({},l,{animales:[...l.animales,clean]});}
        return l;
      });
    });
  }
  function eliminar(id){setLotes(function(prev){return prev.map(function(l){return l.id===loteId?Object.assign({},l,{animales:l.animales.filter(function(x){return x.id!==id;})}):l;});});}

  var detalleAnimal=detalleId?animales.find(function(a){return a.id===detalleId;}):null;
  var gdpVals=animales.map(function(a){return gdpTotal(a.pesajes);}).filter(function(v){return v!==null;}).map(Number);
  var gdpProm=gdpVals.length>0?(gdpVals.reduce(function(s,v){return s+v;},0)/gdpVals.length).toFixed(3):null;
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
          return Object.assign({},a,{pesajes:[...(a.pesajes||[]),{id:Date.now()+Math.random(),peso:reg.peso,fecha:s.fecha}]});
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
        return prev.map(function(e){
          if(e.id===estId)return Object.assign({},e,{lotes:e.lotes.map(function(l){return l.id===loteId?Object.assign({},l,{animales:l.animales.filter(function(a){return a.id!==detalleId;})}):l;})});
          if(e.id===destEstId)return Object.assign({},e,{lotes:e.lotes.map(function(l){return l.id===destLoteId?Object.assign({},l,{animales:[...l.animales,detalleAnimal]}):l;})});
          return e;
        });
      });
    }
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
          <div className="flex items-center justify-between mt-1">
            <button onClick={onBack} className="btn-flash bg-gray-100 text-gray-800 text-2xl font-bold w-11 h-11 rounded-full flex items-center justify-center border border-gray-200">&larr;</button>
            {!esAgro&&(
              <div className="flex gap-2">
                {esMixto&&<button onClick={function(){setShowAgro(true);}} style={{boxShadow:"0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.08)"}} className="btn-flash bg-amber-400 text-amber-900 font-bold px-3 py-2 rounded-xl text-sm border border-amber-400">🌾 Agro</button>}

                <button onClick={function(){setShowHistorial(true);}} style={{boxShadow:"0 1px 3px rgba(0,0,0,0.12)"}} className="btn-flash bg-white border border-gray-200 text-gray-700 font-bold px-3 py-2 rounded-xl text-sm">📅{sesiones.length>0?" "+sesiones.length:""}</button>
                <button onClick={function(){setVista("manga");}} style={{boxShadow:"0 1px 3px rgba(0,0,0,0.12)"}} className={"btn-flash font-bold px-3 py-2 rounded-xl text-sm border "+(sesionEnCurso?"bg-amber-500 border-amber-500 text-white":"bg-sky-400 border-sky-400 text-white")}>
                  {sesionEnCurso?"⚖️ Retomar":"⚖️ Pesar"}
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
              <div className="text-center py-16 text-gray-300"><p className="text-4xl mb-3">🌾</p><p className="text-sm">{animales.length===0?"Agregá el primer animal":"Sin resultados"}</p></div>
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
      }} onUpdate={actualizar} onDelete={eliminar} lotes={allLotes} loteActualId={loteId} establecimientos={establecimientos} estId={estId} onMoverEst={moverEst}/>}
      {resumenSesion&&<ResumenSesionModal sesion={resumenSesion} nombreLote={lote.nombre} animales={animales} onVerAnimal={function(id){setSesionPendienteReabrir(resumenSesion);setResumenSesion(null);setDetalleId(id);}} onClose={function(){setResumenSesion(null);}}/>}
      {showHistorial&&<HistorialModal sesiones={sesiones} onClose={function(){setShowHistorial(false);}} onVerSesion={function(s){setShowHistorial(false);setResumenSesion(s);}} onEliminarSesion={function(id){setLotes(function(prev){return prev.map(function(l){return l.id===loteId?Object.assign({},l,{sesiones:l.sesiones.filter(function(s){return s.id!==id;})}):l;});});}}/>}
      {showRepro&&<ReproModal lote={lote} toros={establecimientos?(establecimientos.find(function(e){return e.id===estId;})||{}).toros||[]:lote.toros||[]} onClose={function(){setShowRepro(false);}} onUpdate={function(sesion,nuevosAnimales,deleteId){
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
              <button onClick={function(){setShowAlertas(true);}} style={{boxShadow:"0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.08)"}} className={"btn-flash border font-bold px-4 py-3 rounded-xl text-2xl "+(alertasActivas.length>0?"bg-amber-500 border-amber-500 text-white":"bg-white border-gray-200 text-gray-700")}>
                {"🔔"+(alertasActivas.length>0?" "+alertasActivas.length:"")}
              </button>
              <button onClick={function(){setShowNuevoLote(true);}} style={{boxShadow:"0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.08)"}} className="btn-flash bg-emerald-300 text-white font-black px-5 py-3 rounded-xl text-base border border-emerald-300">+ Lote</button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-xl mx-auto px-4 py-4 flex flex-col gap-3">
        {alertasActivas.length>0&&(
          <button onClick={function(){setShowAlertas(true);}} className="w-full text-left bg-amber-900/20 border border-amber-700/50 rounded-2xl px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="text-amber-400">🔔</span>
              <p className="text-amber-300 font-bold text-sm">{alertasActivas.length+" alerta"+(alertasActivas.length>1?"s":"")+" pendiente"+(alertasActivas.length>1?"s":"")}</p>
            </div>
          </button>
        )}

        {lotes.length===0&&(
          <div className="text-center py-16 text-gray-400"><p className="text-5xl mb-3">🐄</p><p className="text-sm">Creá el primer lote</p></div>
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
          window.location.reload();
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
          <div className="text-center py-20 text-gray-400">
            <p className="text-6xl mb-4">🐄</p>
            <p className="text-xl font-black text-gray-500 mb-2">Bienvenido a Rodeo</p>
            <p className="text-sm">Creá tu primer establecimiento para empezar</p>
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

        {/* Dashboard stats globales */}
        {establecimientos.length>0&&(function(){
          var totalAnim=establecimientos.reduce(function(s,e){return s+(e.lotes||[]).reduce(function(s2,l){return s2+(l.animales||[]).length;},0);},0);
          var totalLotes=establecimientos.reduce(function(s,e){return s+(e.lotes||[]).length;},0);
          var totalAlertas=establecimientos.reduce(function(s,e){return s+(e.alertas||[]).filter(function(a){var es=estadoAlerta(a.fechaHora,a.pasada);return es==="urgente"||es==="pronto";}).length;},0);
          // Próximos partos (60 días)
          var hoyD=new Date();var en60=new Date();en60.setDate(en60.getDate()+60);
          var partosProx=0;
          establecimientos.forEach(function(e){
            (e.lotes||[]).forEach(function(l){
              (l.reproSesiones||[]).filter(function(s){return s.tipo==="servicio";}).forEach(function(s){
                (s.registros||[]).forEach(function(r){
                  if(!r.fechaPartoProbable)return;
                  var fp=new Date(r.fechaPartoProbable+"T12:00:00");
                  if(fp>=hoyD&&fp<=en60)partosProx++;
                });
              });
            });
          });
          return(
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-3 text-center">
                <p className="text-2xl font-black text-emerald-700">{totalAnim}</p>
                <p className="text-[10px] text-emerald-600 uppercase font-bold">Animales totales</p>
              </div>
              <div className="bg-gray-50 border border-gray-200 rounded-2xl p-3 text-center">
                <p className="text-2xl font-black text-gray-700">{totalLotes}</p>
                <p className="text-[10px] text-gray-500 uppercase font-bold">Lotes</p>
              </div>
              {totalAlertas>0&&(
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3 text-center">
                  <p className="text-2xl font-black text-amber-700">🔔 {totalAlertas}</p>
                  <p className="text-[10px] text-amber-600 uppercase font-bold">Alertas activas</p>
                </div>
              )}
              {partosProx>0&&(
                <div className="bg-rose-50 border border-rose-200 rounded-2xl p-3 text-center">
                  <p className="text-2xl font-black text-rose-700">🐄 {partosProx}</p>
                  <p className="text-[10px] text-rose-600 uppercase font-bold">Partos (60d)</p>
                </div>
              )}
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
