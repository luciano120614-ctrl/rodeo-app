import { useState, useEffect, useRef, useCallback } from "react";

const CATEGORIAS = ["Ternero/a","Novillito","Novillo","Vaquillona","Vaca","Toro","Torito"];
const SEXOS = ["Macho","Hembra"];

// ── Storage ───────────────────────────────────────────────────────────────────
function useStorage(key,ini){
  const[v,s]=useState(()=>{try{const x=localStorage.getItem(key);return x?JSON.parse(x):ini}catch{return ini}});
  useEffect(()=>{try{localStorage.setItem(key,JSON.stringify(v))}catch{}},[key,v]);
  return[v,s];
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function gdpTotal(pesajes){
  if(!pesajes||pesajes.length<2)return null;
  const s=[...pesajes].sort((a,b)=>new Date(a.fecha)-new Date(b.fecha));
  const dias=(new Date(s[s.length-1].fecha)-new Date(s[0].fecha))/86400000;
  if(dias<=0)return null;
  return((s[s.length-1].peso-s[0].peso)/dias).toFixed(3);
}
function hoy(){return new Date().toISOString().slice(0,10)}
function fmtFecha(f){return new Date(f+"T12:00:00").toLocaleDateString("es-AR",{day:"2-digit",month:"2-digit",year:"numeric"})}
function ultimoPeso(animales_pesajes){return [...(animales_pesajes||[])].sort((a,b)=>new Date(b.fecha)-new Date(a.fecha))[0]?.peso??null}

// ── UI Base ───────────────────────────────────────────────────────────────────
function Badge({text,color}){
  const c={macho:"bg-sky-800 text-sky-100 border-sky-600",hembra:"bg-rose-800 text-rose-100 border-rose-600"};
  return <span className={`text-xs px-2 py-0.5 rounded-full font-semibold border ${c[color]||"bg-amber-800 text-amber-100 border-amber-600"}`}>{text}</span>
}

function Modal({title,onClose,children}){
  return(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-blue-950/80 backdrop-blur-sm p-3">
      <div className="bg-[#3d6b20] border border-[#6aaa38] rounded-2xl w-full max-w-md shadow-2xl max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#5a9028] shrink-0">
          <h2 className="text-base font-bold text-[#e8f8c0]">{title}</h2>
          <button onClick={onClose} className="text-[#c8f080] hover:text-white text-xl w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition-colors">✕</button>
        </div>
        <div className="p-5 overflow-y-auto">{children}</div>
      </div>
    </div>
  )
}

function Inp({label,className="",inputRef,...p}){
  return(
    <div className={`flex flex-col gap-1 ${className}`}>
      {label&&<label className="text-[10px] text-[#90c060] font-bold uppercase tracking-wider">{label}</label>}
      <input ref={inputRef} {...p} className="bg-[#2a5015] border border-[#5a9028] rounded-xl px-3 py-2.5 text-[#eaf8c0] text-sm focus:outline-none focus:border-[#8ad030] placeholder-[#4a7030] transition-colors"/>
    </div>
  )
}

function Sel({label,options,className="",...p}){
  return(
    <div className={`flex flex-col gap-1 ${className}`}>
      {label&&<label className="text-[10px] text-[#90c060] font-bold uppercase tracking-wider">{label}</label>}
      <select {...p} className="bg-[#2a5015] border border-[#5a9028] rounded-xl px-3 py-2.5 text-[#eaf8c0] text-sm focus:outline-none focus:border-[#8ad030] transition-colors">
        <option value="">— Seleccionar —</option>
        {options.map(o=><option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  )
}

// ── Nuevo Lote ────────────────────────────────────────────────────────────────
function NuevoLoteModal({onClose,onSave,loteEditar=null}){
  const[nombre,setNombre]=useState(loteEditar?.nombre||"");
  const ref=useRef();
  useEffect(()=>{ref.current?.focus()},[]);
  const save=()=>{if(!nombre.trim())return alert("Ingresá un nombre.");onSave(nombre.trim());onClose()};
  return(
    <Modal title={loteEditar?"✏️ Renombrar Lote":"🌿 Nuevo Lote"} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <Inp label="Nombre del lote" inputRef={ref} placeholder="Ej: Potrero Norte, Corral Engorde..." value={nombre} onChange={e=>setNombre(e.target.value)} onKeyDown={e=>e.key==="Enter"&&save()}/>
        <button onClick={save} className="w-full bg-[#5aaa22] hover:bg-[#6aca2a] text-[#0a2000] font-bold py-3 rounded-xl text-sm transition-colors border border-[#7ada3a]">{loteEditar?"Guardar nombre":"Crear Lote"}</button>
      </div>
    </Modal>
  )
}

// ── Nuevo Animal ──────────────────────────────────────────────────────────────
function NuevoAnimalModal({onClose,onSave,caravanaInicial=""}){
  const[f,setF]=useState({caravana:caravanaInicial,sexo:"",categoria:"",obs:"",peso:"",fecha:hoy()});
  const ref=useRef();
  useEffect(()=>{if(!caravanaInicial)ref.current?.focus()},[]);
  const set=(k,v)=>setF(p=>({...p,[k]:v}));
  const save=()=>{
    if(!f.caravana.trim())return alert("Ingresá la caravana.");
    if(!f.sexo)return alert("Seleccioná el sexo.");
    if(!f.categoria)return alert("Seleccioná la categoría.");
    onSave({id:Date.now(),caravana:f.caravana.trim().toUpperCase(),sexo:f.sexo,categoria:f.categoria,obs:f.obs,
      pesajes:f.peso?[{id:Date.now(),peso:parseFloat(f.peso),fecha:f.fecha}]:[]});
    onClose();
  };
  return(
    <Modal title="🐄 Nuevo Animal" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <Inp label="N° Caravana" inputRef={ref} placeholder="Ej: 001234" value={f.caravana} onChange={e=>set("caravana",e.target.value)}/>
        <div className="grid grid-cols-2 gap-3">
          <Sel label="Sexo" options={SEXOS} value={f.sexo} onChange={e=>set("sexo",e.target.value)}/>
          <Sel label="Categoría" options={CATEGORIAS} value={f.categoria} onChange={e=>set("categoria",e.target.value)}/>
        </div>
        <div className="border-t border-[#3a6020] pt-3">
          <p className="text-[10px] text-[#90c060] uppercase tracking-wider font-bold mb-2">Pesaje inicial (opcional)</p>
          <div className="grid grid-cols-2 gap-3">
            <Inp label="Peso (kg)" type="number" placeholder="320" value={f.peso} onChange={e=>set("peso",e.target.value)}/>
            <Inp label="Fecha" type="date" value={f.fecha} onChange={e=>set("fecha",e.target.value)}/>
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-[#90c060] font-bold uppercase tracking-wider">Observaciones</label>
          <textarea rows={2} value={f.obs} onChange={e=>set("obs",e.target.value)} placeholder="Notas..."
            className="bg-[#2a5015] border border-[#5a9028] rounded-xl px-3 py-2 text-[#eaf8c0] text-sm focus:outline-none focus:border-[#8ad030] resize-none placeholder-[#4a7030]"/>
        </div>
        <button onClick={save} className="w-full bg-[#5aaa22] hover:bg-[#6aca2a] text-[#0a2000] font-bold py-3 rounded-xl text-sm transition-colors border border-[#7ada3a]">Guardar Animal</button>
      </div>
    </Modal>
  )
}

// ── Detalle Animal ────────────────────────────────────────────────────────────
function DetalleModal({animal,onClose,onUpdate,onDelete,lotes,loteActualId}){
  const[tab,setTab]=useState("info");
  const[obs,setObs]=useState(animal.obs||"");
  const[peso,setPeso]=useState("");
  const[fecha,setFecha]=useState(hoy());
  const[showMover,setShowMover]=useState(false);
  const[loteDestino,setLoteDestino]=useState("");
  const pesoRef=useRef();
  const sorted=[...(animal.pesajes||[])].sort((a,b)=>new Date(b.fecha)-new Date(a.fecha));
  const up=ultimoPeso(animal.pesajes);
  const g=gdpTotal(animal.pesajes);
  const addPeso=()=>{
    if(!peso)return pesoRef.current?.focus();
    onUpdate({...animal,pesajes:[...(animal.pesajes||[]),{id:Date.now(),peso:parseFloat(peso),fecha}]});
    setPeso("");pesoRef.current?.focus();
  };
  const otrosLotes=lotes.filter(l=>l.id!==loteActualId);
  return(
    <Modal title={`Caravana ${animal.caravana}`} onClose={onClose}>
      <div className="flex gap-1 mb-4 bg-[#0f2a40] rounded-xl p-1">
        {["info","pesajes"].map(t=>(
          <button key={t} onClick={()=>setTab(t)}
            className={`flex-1 py-3 rounded-xl text-sm font-black uppercase tracking-wider transition-all border-2 ${tab===t?"bg-[#1a72b8] border-[#4aaae8] text-white shadow-lg":"bg-[#0f2a40] border-[#1a5070] text-[#7ad0f0] hover:border-[#3a8aaa] hover:text-white"}`}>
            {t==="info"?"📋 Info":"⚖️ Pesajes"}
          </button>
        ))}
      </div>
      {tab==="info"&&(
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-2">
            {[["Sexo",animal.sexo],["Categoría",animal.categoria],["Último peso",up?`${up} kg`:"—"],["GDP total",g!==null?`${g} kg/d`:"—"]].map(([l,v])=>(
              <div key={l} className="bg-[#2a5015] border border-[#5a9028] rounded-xl p-3">
                <p className="text-xs text-[#b8e878] uppercase tracking-wider mb-1 font-bold">{l}</p>
                <p className={`font-black text-base ${l==="GDP total"&&g!==null?(parseFloat(g)>=0?"text-green-300":"text-red-300"):"text-white"}`}>{v}</p>
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-[#b8e878] font-bold uppercase tracking-wider">Observaciones</label>
            <textarea rows={3} value={obs} onChange={e=>setObs(e.target.value)}
              className="bg-[#2a5015] border border-[#5a9028] rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-[#9ad040] resize-none"/>
            <button onClick={()=>onUpdate({...animal,obs})} className="self-end text-xs bg-[#4a8020] hover:bg-[#5a9a30] text-white border border-[#5a9028] px-3 py-1.5 rounded-lg transition-colors">Guardar</button>
          </div>
          {otrosLotes.length>0&&(
            <div className="border-t border-[#3a6020] pt-3">
              {!showMover?(
                <button onClick={()=>setShowMover(true)} className="w-full text-sm text-[#7ad0f0] border border-[#1a5070] hover:bg-[#0f2a40] py-2.5 rounded-xl transition-colors">🔀 Mover a otro lote</button>
              ):(
                <div className="flex flex-col gap-2">
                  <label className="text-[10px] text-[#b8e878] font-bold uppercase tracking-wider">Mover a</label>
                  <select value={loteDestino} onChange={e=>setLoteDestino(e.target.value)} className="bg-[#2a5015] border border-[#5a9028] rounded-xl px-3 py-2.5 text-[#eaf8c0] text-sm focus:outline-none focus:border-[#8ad030]">
                    <option value="">— Elegir lote —</option>
                    {otrosLotes.map(l=><option key={l.id} value={l.id}>{l.nombre}</option>)}
                  </select>
                  <div className="flex gap-2">
                    <button onClick={()=>setShowMover(false)} className="flex-1 text-sm text-[#7a9a50] border border-[#2a4a18] py-2 rounded-xl">Cancelar</button>
                    <button onClick={()=>{if(!loteDestino)return;onUpdate({...animal,_moverA:loteDestino});onClose()}} className="flex-1 bg-[#1a72b8] hover:bg-[#2a82c8] text-white font-bold py-2 rounded-xl text-sm">Confirmar</button>
                  </div>
                </div>
              )}
            </div>
          )}
          <button onClick={()=>{if(confirm("¿Eliminar este animal?")){onDelete(animal.id);onClose()}}} className="w-full text-sm text-red-300 border border-red-700 hover:bg-red-900/40 py-2.5 rounded-xl transition-colors">🗑 Eliminar animal</button>
        </div>
      )}
      {tab==="pesajes"&&(
        <div className="flex flex-col gap-3">
          <div className="flex gap-2">
            <input ref={pesoRef} type="number" placeholder="Peso kg" value={peso} onChange={e=>setPeso(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addPeso()}
              className="flex-1 bg-[#2a5015] border border-[#5a9028] rounded-xl px-3 py-2.5 text-[#eaf8c0] text-sm focus:outline-none focus:border-[#8ad030] placeholder-[#4a7030]"/>
            <input type="date" value={fecha} onChange={e=>setFecha(e.target.value)} className="bg-[#2a5015] border border-[#5a9028] rounded-xl px-3 py-2 text-[#eaf8c0] text-sm focus:outline-none focus:border-[#8ad030] w-36"/>
            <button onClick={addPeso} className="bg-[#5aaa22] hover:bg-[#6aca2a] text-[#0a2000] w-10 rounded-xl text-lg font-bold transition-colors shrink-0">+</button>
          </div>
          <div className="flex flex-col gap-2 max-h-48 overflow-y-auto pr-1">
            {sorted.length===0&&<p className="text-[#b8e878] text-sm text-center py-6">Sin pesajes aún</p>}
            {sorted.map((p,i)=>{
              const prev=sorted[i+1];let loc=null;
              if(prev){const d=(new Date(p.fecha)-new Date(prev.fecha))/86400000;if(d>0)loc=((p.peso-prev.peso)/d).toFixed(3)}
              return(
                <div key={p.id} className="flex items-center justify-between bg-[#2a5015] border border-[#5a9028] rounded-xl px-3 py-2.5">
                  <div><p className="text-white font-bold text-sm">{p.peso} kg</p><p className="text-[#c8f080] text-sm font-semibold">{fmtFecha(p.fecha)}</p></div>
                  <div className="flex items-center gap-3">
                    {loc!==null&&<span className={`text-xs font-semibold ${parseFloat(loc)>=0?"text-green-300":"text-red-300"}`}>{loc} kg/d</span>}
                    <button onClick={()=>{if(confirm("¿Eliminar?"))onUpdate({...animal,pesajes:animal.pesajes.filter(x=>x.id!==p.id)})}} className="text-red-500 hover:text-red-300 transition-colors text-lg leading-none">✕</button>
                  </div>
                </div>
              )
            })}
          </div>
          {g!==null&&(
            <div className="bg-[#2a5015] border border-[#6aaa30] rounded-xl p-3 text-center">
              <p className="text-xs text-[#b8e878] font-bold uppercase tracking-wider">GDP total</p>
              <p className={`text-xl font-bold mt-1 ${parseFloat(g)>=0?"text-green-300":"text-red-300"}`}>{g} kg/día</p>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}

// ── Resumen Sesión ────────────────────────────────────────────────────────────
function ResumenSesionModal({sesion,onClose}){
  const gdpVals=sesion.registros.map(r=>r.gdpAnimal).filter(v=>v!==null);
  const gdpProm=gdpVals.length>0?(gdpVals.reduce((s,v)=>s+v,0)/gdpVals.length).toFixed(3):null;
  const totalKg=sesion.registros.reduce((s,r)=>s+r.peso,0);
  return(
    <Modal title="📋 Resumen de Sesión" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="text-center pb-2 border-b border-[#3a6020]">
          <p className="text-[#90c060] text-xs uppercase tracking-wider">Sesión del</p>
          <p className="text-[#e8f8c0] font-bold text-lg">{fmtFecha(sesion.fecha)}</p>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {[["Animales",sesion.registros.length,null],["kg totales",totalKg.toLocaleString("es-AR"),null],["GDP kg/d",gdpProm??"—",gdpProm]].map(([l,v,gv])=>(
            <div key={l} className="bg-[#2a5015] border border-[#5a9028] rounded-2xl p-3 text-center">
              <p className={`text-2xl font-black ${gv!==null?(parseFloat(gv)>=0?"text-green-300":"text-red-300"):"text-white"}`}>{v}</p>
              <p className="text-[10px] text-[#7aaa40] uppercase tracking-wider mt-1">{l}</p>
            </div>
          ))}
        </div>
        {gdpProm!==null&&(
          <div className="bg-[#2a5015] border border-[#4a8020] rounded-xl p-3 text-center">
            <p className="text-xs text-[#90c060]">Ganancia diaria promedio del lote</p>
            <p className={`text-2xl font-bold mt-1 ${parseFloat(gdpProm)>=0?"text-green-300":"text-red-300"}`}>{gdpProm} kg/animal/día</p>
          </div>
        )}
        <div>
          <p className="text-[10px] text-[#90c060] uppercase tracking-wider font-bold mb-2">Detalle</p>
          <div className="flex flex-col gap-1.5 max-h-52 overflow-y-auto pr-1">
            {sesion.registros.map((r,i)=>(
              <div key={i} className="flex items-center justify-between bg-[#2a5015] border border-[#5a9028] rounded-xl px-3 py-2">
                <div><p className="text-white font-bold text-sm">{r.caravana}</p><div className="flex gap-1 mt-0.5"><Badge text={r.sexo} color={r.sexo==="Macho"?"macho":"hembra"}/><Badge text={r.categoria}/></div></div>
                <div className="text-right"><p className="text-[#a0d060] font-bold text-sm">{r.peso} kg</p>{r.gdpAnimal!==null&&<p className={`text-xs ${r.gdpAnimal>=0?"text-green-300":"text-red-300"}`}>{r.gdpAnimal.toFixed(3)} kg/d</p>}</div>
              </div>
            ))}
          </div>
        </div>
        <button onClick={onClose} className="w-full bg-[#5aaa22] hover:bg-[#6aca2a] text-[#0a2000] font-bold py-2.5 rounded-xl text-sm transition-colors border border-[#7ada3a]">Cerrar</button>
      </div>
    </Modal>
  )
}

// ── Historial ─────────────────────────────────────────────────────────────────
function HistorialModal({sesiones,onClose,onVerSesion,onEliminarSesion}){
  return(
    <Modal title="📅 Historial de Sesiones" onClose={onClose}>
      <div className="flex flex-col gap-2">
        {sesiones.length===0&&<div className="text-center py-10 text-[#5a8a30]"><p className="text-3xl mb-2">📋</p><p className="text-sm">No hay sesiones guardadas</p></div>}
        {[...sesiones].sort((a,b)=>b.fecha.localeCompare(a.fecha)).map(s=>{
          const totalKg=s.registros.reduce((sum,r)=>sum+r.peso,0);
          const gv=s.registros.map(r=>r.gdpAnimal).filter(v=>v!==null);
          const gp=gv.length>0?(gv.reduce((a,v)=>a+v,0)/gv.length).toFixed(3):null;
          return(
            <div key={s.id} className="bg-[#2a5015] border border-[#5a9028] rounded-2xl overflow-hidden">
              <button onClick={()=>onVerSesion(s)} className="w-full text-left px-4 py-3 hover:bg-[#3a6020] transition-colors">
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-white font-bold text-sm">{fmtFecha(s.fecha)}</p>
                  <span className="text-[10px] text-[#7aaa40] bg-[#1a3a10] border border-[#2a5018] px-2 py-0.5 rounded-full">{s.registros.length} animales</span>
                </div>
                <div className="flex gap-4">
                  <div><p className="text-[10px] text-[#7a9a50] uppercase">Total kg</p><p className="text-[#a0d060] font-bold text-sm">{totalKg.toLocaleString("es-AR")} kg</p></div>
                  <div><p className="text-[10px] text-[#7a9a50] uppercase">GDP prom.</p><p className={`font-bold text-sm ${gp!==null?(parseFloat(gp)>=0?"text-green-300":"text-red-300"):"text-[#4a7030]"}`}>{gp?`${gp} kg/d`:"—"}</p></div>
                </div>
              </button>
              <div className="border-t border-[#3a6020] px-4 py-2 flex justify-end">
                <button onClick={()=>{if(confirm("¿Eliminar?"))onEliminarSesion(s.id)}} className="text-xs text-red-500 hover:text-red-300 transition-colors">🗑 Eliminar</button>
              </div>
            </div>
          )
        })}
      </div>
    </Modal>
  )
}

// ── Modo Manga ────────────────────────────────────────────────────────────────
// Recibe loteId y setLotes directamente — actualiza el estado global sin closures stale
function SesionPesaje({loteId,setLotes,onPausar,onFinalizar,sesionInicial,nombreLote}){
  const[log,setLog]=useState(sesionInicial?.registros||[]);
  const[fecha]=useState(sesionInicial?.fecha||hoy());
  const[busq,setBusq]=useState("");
  const[encontradoId,setEncontradoId]=useState(null);
  const[peso,setPeso]=useState("");
  const[flash,setFlash]=useState(false);
  const[animalesLocales,setAnimalesLocales]=useState([]);
  const busqRef=useRef();
  const pesoRef=useRef();

  // Sincronizar animales desde lotes al montar
  useEffect(()=>{
    const stored=localStorage.getItem("ganadera_lotes_v1");
    if(stored){
      const lotes=JSON.parse(stored);
      const lote=lotes.find(l=>l.id===loteId);
      if(lote)setAnimalesLocales(lote.animales||[]);
    }
    busqRef.current?.focus();
  },[]);

  const encontrado=animalesLocales.find(a=>a.id===encontradoId)||null;
  const yaRegistrado=encontrado&&log.some(r=>r.caravana===encontrado.caravana);
  const noEncontrado=busq.trim().length>0&&!encontrado;

  const buscar=useCallback((val)=>{
    const q=val.trim().toUpperCase();
    if(!q){setEncontradoId(null);return}
    // Leer siempre del localStorage para tener animales frescos
    const stored=localStorage.getItem("ganadera_lotes_v1");
    const lotes=stored?JSON.parse(stored):[];
    const lote=lotes.find(l=>l.id===loteId);
    const match=(lote?.animales||[]).find(a=>a.caravana===q);
    if(match){
      setAnimalesLocales(lote.animales);
      setEncontradoId(match.id);
      setTimeout(()=>pesoRef.current?.focus(),60);
    } else {
      setEncontradoId(null);
    }
  },[loteId]);

  const handleBusqChange=e=>{setBusq(e.target.value);buscar(e.target.value)};
  const handleBusqKey=e=>{if(e.key==="Enter")buscar(busq)};

  const registrar=()=>{
    if(!encontrado||!peso)return pesoRef.current?.focus();
    if(yaRegistrado)return;
    const np={id:Date.now(),peso:parseFloat(peso),fecha};
    const animalActualizado={...encontrado,pesajes:[...(encontrado.pesajes||[]),np]};
    // Actualizar localStorage directamente — siempre fresco
    setLotes(prev=>{
      const nuevos=prev.map(l=>{
        if(l.id!==loteId)return l;
        return{...l,animales:l.animales.map(a=>a.id===animalActualizado.id?animalActualizado:a)};
      });
      // Actualizar animalesLocales también
      const loteNuevo=nuevos.find(l=>l.id===loteId);
      if(loteNuevo)setAnimalesLocales(loteNuevo.animales);
      return nuevos;
    });
    const ga=gdpTotal(animalActualizado.pesajes);
    setLog(prev=>[{caravana:encontrado.caravana,peso:parseFloat(peso),sexo:encontrado.sexo,categoria:encontrado.categoria,gdpAnimal:ga!==null?parseFloat(ga):null,id:Date.now()},...prev]);
    setFlash(true);setTimeout(()=>setFlash(false),600);
    setBusq("");setPeso("");setEncontradoId(null);
    setTimeout(()=>busqRef.current?.focus(),80);
  };

  const totalKg=log.reduce((s,r)=>s+r.peso,0);
  const gdpVals=log.map(r=>r.gdpAnimal).filter(v=>v!==null);
  const gdpProm=gdpVals.length>0?(gdpVals.reduce((s,v)=>s+v,0)/gdpVals.length).toFixed(3):null;

  return(
    <div className="fixed inset-0 z-40 bg-[#060d04] flex flex-col" style={{fontFamily:"'DM Sans',sans-serif"}}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600;700;900&display=swap" rel="stylesheet"/>
      <div className="bg-[#0a1607] border-b border-[#1a3010] px-4 py-3 shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] text-[#4a6a28] uppercase tracking-widest font-bold">Modo Manga · {nombreLote}</p>
            <h2 className="text-lg font-bold text-[#c8e6a0]">Sesión de Pesaje</h2>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-[#4a6a28] border border-[#1a2e10] px-2 py-1 rounded-lg">{fmtFecha(fecha)}</span>
            <button onClick={()=>onPausar({fecha,registros:log})} className="bg-[#1a2e10] hover:bg-[#253d18] border border-[#2a4a18] text-[#8ac040] font-bold px-3 py-1.5 rounded-xl text-xs transition-colors">⏸ Pausar</button>
            <button onClick={()=>onFinalizar({fecha,registros:[...log].reverse()})} className="bg-red-700 hover:bg-red-600 active:scale-95 text-white font-black px-4 py-1.5 rounded-xl text-sm transition-colors shadow-lg">FIN</button>
          </div>
        </div>
      </div>

      {log.length>0&&(
        <div className="bg-[#0a1f07] border-b border-[#1a3010] px-4 py-2 flex gap-5 shrink-0">
          <div className="flex items-center gap-1.5"><span className="text-[10px] text-[#4a6a28] uppercase">Pesados:</span><span className="text-[#c8e6a0] font-bold text-sm">{log.length}</span></div>
          <div className="flex items-center gap-1.5"><span className="text-[10px] text-[#4a6a28] uppercase">Total:</span><span className="text-[#c8e6a0] font-bold text-sm">{totalKg.toLocaleString("es-AR")} kg</span></div>
          {gdpProm&&<div className="flex items-center gap-1.5"><span className="text-[10px] text-[#4a6a28] uppercase">GDP:</span><span className={`font-bold text-sm ${parseFloat(gdpProm)>=0?"text-green-400":"text-red-400"}`}>{gdpProm} kg/d</span></div>}
        </div>
      )}

      <div className="flex-1 overflow-y-auto flex flex-col">
        <div className={`px-4 pt-4 pb-3 transition-all duration-300 ${flash?"bg-green-950/50":""}`}>
          <div className="flex flex-col gap-1 mb-3">
            <label className="text-[10px] text-[#7a9a50] font-bold uppercase tracking-wider">📡 Caravana — escaneá o escribí</label>
            <input ref={busqRef} value={busq} onChange={handleBusqChange} onKeyDown={handleBusqKey}
              placeholder="N° caravana..." autoComplete="off" autoCorrect="off" autoCapitalize="characters"
              className="bg-[#0a1207] border-2 border-[#1e3010] focus:border-[#5a9a10] rounded-2xl px-4 py-4 text-[#dff0b0] text-2xl font-bold tracking-widest focus:outline-none placeholder-[#1e3010] transition-colors"/>
          </div>
          {encontrado&&(
            <div className="bg-[#0e2208] border border-[#2a5010] rounded-2xl p-3 mb-3 flex items-center gap-3">
              <div className="bg-[#1a3a10] rounded-xl w-10 h-10 flex items-center justify-center text-green-400 text-xl font-black border border-[#2a5010]">✓</div>
              <div className="flex-1 min-w-0">
                <p className="text-[#c8e6a0] font-bold">{encontrado.caravana}</p>
                <div className="flex gap-1.5 mt-0.5 flex-wrap">
                  <Badge text={encontrado.sexo} color={encontrado.sexo==="Macho"?"macho":"hembra"}/>
                  <Badge text={encontrado.categoria}/>
                  {ultimoPeso(encontrado.pesajes)&&<span className="text-xs text-[#5a8a30]">Último: {ultimoPeso(encontrado.pesajes)} kg</span>}
                </div>
              </div>
            </div>
          )}
          {noEncontrado&&(
            <div className="bg-amber-950/30 border border-amber-900/50 rounded-2xl p-3 mb-3 flex items-center gap-2">
              <span className="text-amber-500 text-lg shrink-0">⚠</span>
              <div><p className="text-amber-300 text-sm font-bold">{busq.toUpperCase()} — no registrado en este lote</p></div>
            </div>
          )}
          {encontrado&&(
            <div className="flex flex-col gap-2">
              <input ref={pesoRef} type="number" inputMode="decimal" value={peso} onChange={e=>setPeso(e.target.value)} onKeyDown={e=>e.key==="Enter"&&registrar()}
                placeholder="Peso en kg"
                className="w-full bg-[#0a1207] border-2 border-[#1e3010] focus:border-[#5a9a10] rounded-2xl px-4 py-4 text-[#dff0b0] text-3xl font-bold focus:outline-none placeholder-[#1e3010] transition-colors text-center"/>
              {yaRegistrado?(
                <div className="w-full bg-red-950/60 border-2 border-red-800 rounded-2xl py-4 flex items-center justify-center gap-3">
                  <span className="text-red-400 text-xl">⚠</span>
                  <div className="text-center"><p className="text-red-300 font-black text-sm">ANIMAL YA PESADO EN ESTA SESIÓN</p></div>
                </div>
              ):(
                <button onClick={registrar} className="w-full bg-[#3d7a10] hover:bg-[#4d9a18] active:scale-95 text-white rounded-2xl py-5 text-2xl font-black transition-all shadow-lg">ENTER</button>
              )}
            </div>
          )}
        </div>
        <div className="px-4 py-2 flex items-center gap-3 shrink-0">
          <div className="flex-1 h-px bg-[#1a2e10]"/>
          <span className="text-[10px] text-[#3a5a20] uppercase tracking-wider font-bold">{log.length} pesajes</span>
          <div className="flex-1 h-px bg-[#1a2e10]"/>
        </div>
        <div className="px-4 pb-4 flex flex-col gap-2">
          {log.length===0&&<div className="text-center py-10 text-[#2a4018]"><p className="text-4xl mb-2">⚖️</p><p className="text-sm">Los pesajes aparecen aquí</p></div>}
          {log.map((l,i)=>(
            <div key={l.id} className={`flex items-center justify-between bg-[#0a1207] border rounded-xl px-4 py-3 ${i===0?"border-green-800/70 bg-green-950/20":"border-[#1a2e10]"}`}>
              <div className="flex items-center gap-2">
                {i===0&&<span className="text-[10px] text-green-500 font-bold uppercase">último</span>}
                <div><p className="text-[#dff0b0] font-bold text-sm">{l.caravana}</p><div className="flex gap-1 mt-0.5"><Badge text={l.sexo} color={l.sexo==="Macho"?"macho":"hembra"}/><Badge text={l.categoria}/></div></div>
              </div>
              <div className="text-right">
                <p className="text-[#a0d060] font-bold text-xl">{l.peso} kg</p>
                {l.gdpAnimal!==null&&<p className={`text-xs font-semibold ${l.gdpAnimal>=0?"text-green-400":"text-red-400"}`}>{l.gdpAnimal.toFixed(3)} kg/d</p>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Vista Lote ────────────────────────────────────────────────────────────────
function VistaLote({loteId,allLotes,setLotes,onBack}){
  const lote=allLotes.find(l=>l.id===loteId);
  const[vista,setVista]=useState("rodeo");
  const[showNuevo,setShowNuevo]=useState(false);
  const[detalleId,setDetalleId]=useState(null);
  const[busq,setBusq]=useState("");
  const[filtroCateg,setFiltroCateg]=useState("");
  const[filtroSexo,setFiltroSexo]=useState("");
  const[filtroPesoMin,setFiltroPesoMin]=useState("");
  const[filtroPesoMax,setFiltroPesoMax]=useState("");
  const[filtrosVisible,setFiltrosVisible]=useState(false);
  const[resumenSesion,setResumenSesion]=useState(null);
  const[showHistorial,setShowHistorial]=useState(false);
  const[showRenombrar,setShowRenombrar]=useState(false);

  if(!lote)return null;

  const animales=lote.animales||[];
  const sesiones=lote.sesiones||[];
  const sesionEnCurso=lote.sesionEnCurso||null;

  const agregar=a=>setLotes(prev=>prev.map(l=>l.id===loteId?{...l,animales:[...l.animales,a]}:l));
  const actualizar=a=>{
    if(a._moverA){
      const{_moverA,...limpio}=a;
      setLotes(prev=>prev.map(l=>{
        if(l.id===loteId)return{...l,animales:l.animales.filter(x=>x.id!==a.id)};
        if(l.id===parseInt(_moverA))return{...l,animales:[...l.animales,limpio]};
        return l;
      }));
    } else {
      setLotes(prev=>prev.map(l=>l.id===loteId?{...l,animales:l.animales.map(x=>x.id===a.id?a:x)}:l));
    }
  };
  const eliminar=id=>setLotes(prev=>prev.map(l=>l.id===loteId?{...l,animales:l.animales.filter(x=>x.id!==id)}:l));

  const pausarSesion=(sesion)=>{
    setLotes(prev=>prev.map(l=>l.id===loteId?{...l,sesionEnCurso:sesion}:l));
    setVista("rodeo");
  };
  const finalizarSesion=sesion=>{
    if(sesion.registros.length>0){
      const sf={...sesion,id:Date.now()};
      setLotes(prev=>prev.map(l=>l.id===loteId?{...l,sesionEnCurso:null,sesiones:[...(l.sesiones||[]),sf]}:l));
      setResumenSesion(sf);
    } else {
      setLotes(prev=>prev.map(l=>l.id===loteId?{...l,sesionEnCurso:null}:l));
    }
    setVista("rodeo");
  };

  const filtrados=animales.filter(a=>{
    const qb=busq.trim().toUpperCase();
    const up=ultimoPeso(a.pesajes);
    return(!qb||a.caravana.includes(qb)||a.obs?.toLowerCase().includes(busq.toLowerCase()))&&
      (!filtroCateg||a.categoria===filtroCateg)&&(!filtroSexo||a.sexo===filtroSexo)&&
      (!filtroPesoMin||up===null||up>=parseFloat(filtroPesoMin))&&
      (!filtroPesoMax||up===null||up<=parseFloat(filtroPesoMax));
  });
  const hayFiltros=filtroCateg||filtroSexo||filtroPesoMin||filtroPesoMax;
  const totalMachos=animales.filter(a=>a.sexo==="Macho").length;
  const totalHembras=animales.filter(a=>a.sexo==="Hembra").length;
  const gdpProm=(()=>{const vals=animales.map(a=>gdpTotal(a.pesajes)).filter(Boolean).map(Number);if(!vals.length)return null;return(vals.reduce((s,v)=>s+v,0)/vals.length).toFixed(3)})();
  const detalleAnimal=detalleId?animales.find(a=>a.id===detalleId):null;

  if(vista==="manga")return(
    <SesionPesaje
      loteId={loteId}
      setLotes={setLotes}
      onPausar={pausarSesion}
      onFinalizar={finalizarSesion}
      sesionInicial={sesionEnCurso}
      nombreLote={lote.nombre}
    />
  );

  return(
    <div className="min-h-screen bg-[#060d04] text-[#c8e6a0]" style={{fontFamily:"'DM Sans',sans-serif"}}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600;700;900&display=swap" rel="stylesheet"/>
      <header className="bg-[#0a1607] border-b border-[#1a2e10] px-4 py-3 sticky top-0 z-10">
        <div className="max-w-xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button onClick={onBack} className="text-[#6a8a40] hover:text-white text-lg w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition-colors">←</button>
            <div>
              <h1 className="text-lg font-bold text-[#c8e6a0]">{lote.nombre}</h1>
              <p className="text-[10px] text-[#4a6a28] uppercase tracking-widest">{animales.length} animales</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={()=>setShowHistorial(true)} className="bg-[#1a2e10] hover:bg-[#253d18] border border-[#2a4a18] text-[#6a8a40] font-bold px-3 py-2 rounded-xl text-xs transition-colors">📅 {sesiones.length>0?sesiones.length:""}</button>
            <button onClick={()=>setVista("manga")} className={`font-bold px-3 py-2 rounded-xl text-xs transition-colors ${sesionEnCurso?"bg-amber-900/60 border border-amber-700 text-amber-300":"bg-[#1a3a08] hover:bg-[#253d10] border border-[#2a5010] text-[#8ac040]"}`}>
              ⚖️ {sesionEnCurso?`Retomar (${sesionEnCurso.registros.length})`:"Pesar"}
            </button>
            <button onClick={()=>setShowNuevo(true)} className="bg-[#5aaa22] hover:bg-[#6aca2a] text-[#0a2000] font-black px-3 py-2 rounded-xl text-xs transition-colors border border-[#7ada3a]">+ Animal</button>
          </div>
        </div>
      </header>

      <main className="max-w-xl mx-auto px-4 py-4 flex flex-col gap-4">
        {sesionEnCurso&&sesionEnCurso.registros.length>0&&(
          <button onClick={()=>setVista("manga")} className="w-full text-left bg-amber-950/30 border border-amber-800/60 rounded-2xl px-4 py-3 hover:bg-amber-950/50 transition-colors">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-amber-400 text-lg">⏸</span>
                <div><p className="text-amber-300 font-bold text-sm">Sesión en curso — {fmtFecha(sesionEnCurso.fecha)}</p><p className="text-amber-700 text-xs">{sesionEnCurso.registros.length} pesajes • Tocá para retomar</p></div>
              </div>
              <span className="text-amber-500 text-lg">▶</span>
            </div>
          </button>
        )}
        {sesiones.length>0&&!sesionEnCurso&&(()=>{
          const ult=[...sesiones].sort((a,b)=>b.fecha.localeCompare(a.fecha))[0];
          const totalKg=ult.registros.reduce((s,r)=>s+r.peso,0);
          return(<button onClick={()=>setResumenSesion(ult)} className="w-full text-left bg-[#0a1f07] border border-[#2a5010] rounded-2xl px-4 py-3 hover:bg-[#0d2a0a] transition-colors">
            <div className="flex items-center justify-between">
              <div><p className="text-[10px] text-[#4a7a28] uppercase font-bold">Última sesión</p><p className="text-[#c8e6a0] font-bold text-sm">{fmtFecha(ult.fecha)}</p></div>
              <div className="flex gap-4 text-right">
                <div><p className="text-[#a0d060] font-bold">{ult.registros.length}</p><p className="text-[9px] text-[#4a6a28] uppercase">animales</p></div>
                <div><p className="text-[#a0d060] font-bold">{totalKg.toLocaleString("es-AR")}</p><p className="text-[9px] text-[#4a6a28] uppercase">kg</p></div>
              </div>
            </div>
          </button>)
        })()}

        <div className="grid grid-cols-3 gap-2">
          {[{icon:"🐄",val:animales.length,label:"Total"},{icon:"⚥",val:`${totalMachos}M / ${totalHembras}H`,label:"Sexo"},{icon:"📈",val:gdpProm?`${gdpProm} kg/d`:"—",label:"GDP prom."}].map(s=>(
            <div key={s.label} className="bg-[#0a1607] border border-[#1a2e10] rounded-2xl p-3 text-center">
              <p className="text-base">{s.icon}</p>
              <p className="text-[#dff0b0] font-bold text-sm leading-tight mt-0.5">{s.val}</p>
              <p className="text-[9px] text-[#3a5a20] mt-0.5 uppercase tracking-wider">{s.label}</p>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <input value={busq} onChange={e=>setBusq(e.target.value)} placeholder="🔍 Buscar caravana..."
              className="flex-1 bg-[#0a1207] border border-[#1e3010] rounded-xl px-3 py-2.5 text-[#dff0b0] text-sm focus:outline-none focus:border-[#6ab020] placeholder-[#2a4018]"/>
            <button onClick={()=>setFiltrosVisible(v=>!v)} className={`px-3 py-2 rounded-xl text-xs font-bold border transition-colors ${hayFiltros?"bg-[#3a6a10] border-[#5a9a20] text-[#c8e6a0]":"bg-[#0a1207] border-[#1e3010] text-[#5a7a30] hover:text-[#9ac060]"}`}>
              ⚙ Filtros{hayFiltros?` (${[filtroCateg,filtroSexo,filtroPesoMin,filtroPesoMax].filter(Boolean).length})`:""}
            </button>
          </div>
          {filtrosVisible&&(
            <div className="bg-[#0a1207] border border-[#1e3010] rounded-2xl p-3 flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-[#5a7a30] uppercase tracking-wider font-bold">Categoría</label>
                  <select value={filtroCateg} onChange={e=>setFiltroCateg(e.target.value)} className="bg-[#0f1a0a] border border-[#1e3010] rounded-xl px-2 py-2 text-[#dff0b0] text-sm focus:outline-none focus:border-[#6ab020]">
                    <option value="">Todas</option>{CATEGORIAS.map(c=><option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-[#5a7a30] uppercase tracking-wider font-bold">Sexo</label>
                  <select value={filtroSexo} onChange={e=>setFiltroSexo(e.target.value)} className="bg-[#0f1a0a] border border-[#1e3010] rounded-xl px-2 py-2 text-[#dff0b0] text-sm focus:outline-none focus:border-[#6ab020]">
                    <option value="">Todos</option><option value="Macho">Macho</option><option value="Hembra">Hembra</option>
                  </select>
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] text-[#5a7a30] uppercase tracking-wider font-bold">Peso (kg)</label>
                <div className="flex items-center gap-2">
                  <input type="number" placeholder="Mín" value={filtroPesoMin} onChange={e=>setFiltroPesoMin(e.target.value)} className="flex-1 bg-[#0f1a0a] border border-[#1e3010] rounded-xl px-3 py-2 text-[#dff0b0] text-sm focus:outline-none focus:border-[#6ab020] placeholder-[#2a4018]"/>
                  <span className="text-[#3a5a20] font-bold">—</span>
                  <input type="number" placeholder="Máx" value={filtroPesoMax} onChange={e=>setFiltroPesoMax(e.target.value)} className="flex-1 bg-[#0f1a0a] border border-[#1e3010] rounded-xl px-3 py-2 text-[#dff0b0] text-sm focus:outline-none focus:border-[#6ab020] placeholder-[#2a4018]"/>
                </div>
              </div>
              {hayFiltros&&<button onClick={()=>{setFiltroCateg("");setFiltroSexo("");setFiltroPesoMin("");setFiltroPesoMax("")}} className="text-xs text-[#6a8a40] hover:text-[#a0c060] transition-colors text-left">✕ Limpiar filtros</button>}
            </div>
          )}
        </div>

        {filtrados.length===0?(
          <div className="text-center py-16 text-[#2a4018]"><p className="text-4xl mb-3">🌾</p><p className="text-sm">{animales.length===0?"Agregá el primer animal":"Sin resultados"}</p></div>
        ):(
          <div className="flex flex-col gap-2">
            {[...filtrados].sort((a,b)=>a.caravana.localeCompare(b.caravana)).map(a=>{
              const g=gdpTotal(a.pesajes);
              const up=ultimoPeso(a.pesajes);
              return(
                <button key={a.id} onClick={()=>setDetalleId(a.id)} className="w-full text-left bg-[#0a1607] border border-[#1a2e10] hover:border-[#3a6a18] rounded-2xl px-4 py-3 transition-all hover:bg-[#0d1e0a]">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="bg-[#142808] rounded-xl w-10 h-10 flex items-center justify-center font-black text-[#6ab020] border border-[#1e3e10] text-sm">{a.caravana.slice(-2)}</div>
                      <div><p className="font-bold text-[#dff0b0] text-sm">{a.caravana}</p><div className="flex gap-1.5 mt-0.5"><Badge text={a.sexo} color={a.sexo==="Macho"?"macho":"hembra"}/><Badge text={a.categoria}/></div></div>
                    </div>
                    <div className="text-right">
                      {up&&<p className="text-[#dff0b0] font-bold text-sm">{up} kg</p>}
                      {g!==null&&<p className={`text-xs font-semibold ${parseFloat(g)>=0?"text-green-400":"text-red-400"}`}>{parseFloat(g)>=0?"▲":"▼"} {Math.abs(g)} kg/d</p>}
                      {!up&&<p className="text-[#2a4018] text-xs">Sin pesaje</p>}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        )}

        <div className="border-t border-[#1a2e10] pt-3 flex gap-2">
          <button onClick={()=>setShowRenombrar(true)} className="flex-1 text-xs text-[#6a8a40] border border-[#1a2e10] hover:bg-[#0d1e0a] py-2 rounded-xl transition-colors">✏️ Renombrar lote</button>
          <button onClick={()=>{if(confirm(`¿Eliminar "${lote.nombre}"?`)){setLotes(prev=>prev.filter(l=>l.id!==loteId));onBack()}}} className="flex-1 text-xs text-red-600 border border-red-900 hover:bg-red-950/30 py-2 rounded-xl transition-colors">🗑 Eliminar lote</button>
        </div>
      </main>

      {showNuevo&&<NuevoAnimalModal onClose={()=>setShowNuevo(false)} onSave={agregar}/>}
      {detalleAnimal&&<DetalleModal key={detalleAnimal.id} animal={detalleAnimal} onClose={()=>setDetalleId(null)} onUpdate={actualizar} onDelete={eliminar} lotes={allLotes} loteActualId={loteId}/>}
      {resumenSesion&&<ResumenSesionModal sesion={resumenSesion} onClose={()=>setResumenSesion(null)}/>}
      {showHistorial&&<HistorialModal sesiones={sesiones} onClose={()=>setShowHistorial(false)} onVerSesion={s=>{setShowHistorial(false);setResumenSesion(s)}} onEliminarSesion={id=>setLotes(prev=>prev.map(l=>l.id===loteId?{...l,sesiones:l.sesiones.filter(s=>s.id!==id)}:l))}/>}
      {showRenombrar&&<NuevoLoteModal loteEditar={lote} onClose={()=>setShowRenombrar(false)} onSave={nombre=>setLotes(prev=>prev.map(l=>l.id===loteId?{...l,nombre}:l))}/>}
    </div>
  )
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function App(){
  const[lotes,setLotes]=useStorage("ganadera_lotes_v1",[]);
  const[loteActivoId,setLoteActivoId]=useState(null);
  const[showNuevoLote,setShowNuevoLote]=useState(false);

  if(loteActivoId&&lotes.find(l=>l.id===loteActivoId)){
    return <VistaLote loteId={loteActivoId} allLotes={lotes} setLotes={setLotes} onBack={()=>setLoteActivoId(null)}/>;
  }

  const totalAnimales=lotes.reduce((s,l)=>s+(l.animales||[]).length,0);

  return(
    <div className="min-h-screen bg-[#060d04] text-[#c8e6a0]" style={{fontFamily:"'DM Sans',sans-serif"}}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600;700;900&display=swap" rel="stylesheet"/>
      <header className="bg-[#0a1607] border-b border-[#1a2e10] px-4 py-4 sticky top-0 z-10">
        <div className="max-w-xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-[#c8e6a0]">🐄 Rodeo</h1>
            <p className="text-[10px] text-[#4a6a28] uppercase tracking-widest">{totalAnimales} animales · {lotes.length} lotes</p>
          </div>
          <button onClick={()=>setShowNuevoLote(true)} className="bg-[#5aaa22] hover:bg-[#6aca2a] text-[#0a2000] font-black px-5 py-2.5 rounded-xl text-base transition-colors shadow-lg border-2 border-[#7ada3a]">＋ Lote</button>
        </div>
      </header>
      <main className="max-w-xl mx-auto px-4 py-4 flex flex-col gap-3">
        {lotes.length===0?(
          <div className="text-center py-20 text-[#2a4018]">
            <p className="text-5xl mb-4">🌾</p>
            <p className="text-base font-bold text-[#4a7a30] mb-1">Sin lotes todavía</p>
            <p className="text-sm mb-6">Creá tu primer lote para empezar</p>
            <button onClick={()=>setShowNuevoLote(true)} className="bg-[#5aaa22] hover:bg-[#6aca2a] text-[#0a2000] font-black px-6 py-3 rounded-2xl text-sm transition-colors border-2 border-[#7ada3a]">＋ Crear primer lote</button>
          </div>
        ):(
          lotes.map(lote=>{
            const animales=lote.animales||[];
            const machos=animales.filter(a=>a.sexo==="Macho").length;
            const hembras=animales.filter(a=>a.sexo==="Hembra").length;
            const ult=[...(lote.sesiones||[])].sort((a,b)=>b.fecha.localeCompare(a.fecha))[0]||null;
            const enCurso=lote.sesionEnCurso&&lote.sesionEnCurso.registros.length>0;
            return(
              <button key={lote.id} onClick={()=>setLoteActivoId(lote.id)} className="w-full text-left bg-[#0a1607] border border-[#1a2e10] hover:border-[#3a6a18] rounded-2xl px-4 py-4 transition-all hover:bg-[#0d1e0a]">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className="bg-[#142808] rounded-xl w-10 h-10 flex items-center justify-center text-[#6ab020] text-xl border border-[#1e3e10]">🌿</div>
                    <div>
                      <p className="font-bold text-[#dff0b0] text-base">{lote.nombre}</p>
                      <p className="text-[10px] text-[#4a6a28] uppercase tracking-wider">{animales.length} animales · {machos}M {hembras}H</p>
                    </div>
                  </div>
                  {enCurso&&<span className="text-[10px] bg-amber-900/50 text-amber-300 border border-amber-700 px-2 py-0.5 rounded-full font-bold">⏸ EN CURSO</span>}
                </div>
                {ult&&<p className="text-[10px] text-[#3a5a20]">Última sesión: {fmtFecha(ult.fecha)} · {ult.registros.length} pesajes</p>}
              </button>
            )
          })
        )}
      </main>
      {showNuevoLote&&<NuevoLoteModal onClose={()=>setShowNuevoLote(false)} onSave={nombre=>{setLotes(prev=>[...prev,{id:Date.now(),nombre,animales:[],sesiones:[],sesionEnCurso:null}])}}/>}
    </div>
  )
}
