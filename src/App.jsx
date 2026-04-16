import { useState, useEffect } from "react";

function useStorage(key, ini){
  const [v, setV] = useState(()=>{
    try{
      const x = localStorage.getItem(key);
      return x ? JSON.parse(x) : ini;
    }catch{
      return ini;
    }
  });

  useEffect(()=>{
    try{
      localStorage.setItem(key, JSON.stringify(v));
    }catch{}
  },[key,v]);

  return [v,setV];
}

function NuevoLoteModal({onClose,onSave}){
  const [nombre,setNombre] = useState("");

  return(
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl p-4 w-full max-w-sm">
        <h2 className="font-semibold mb-3">Nuevo lote</h2>

        <input
          value={nombre}
          onChange={e=>setNombre(e.target.value)}
          placeholder="Nombre del lote"
          className="w-full border rounded-lg px-3 py-2 mb-4"
        />

        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 border rounded-lg py-2">
            Cancelar
          </button>
          <button 
            onClick={()=>{
              if(!nombre) return;
              onSave(nombre);
              onClose();
            }}
            className="flex-1 bg-black text-white rounded-lg py-2"
          >
            Crear
          </button>
        </div>
      </div>
    </div>
  );
}

export default function App(){
  const [lotes,setLotes] = useStorage("ganadera_lotes_v1",[]);
  const [showNuevo,setShowNuevo] = useState(false);

  const totalAnimales = lotes.reduce((s,l)=>s+(l.animales||[]).length,0);

  return(
    <div className="min-h-screen bg-[#f5f5f5] text-[#111]">
      
      <header className="flex items-center justify-between px-4 py-4 border-b bg-white">
        <div>
          <h1 className="text-xl font-semibold">🐄 Rodeo</h1>
          <p className="text-sm text-gray-500">
            {totalAnimales} animales · {lotes.length} lotes
          </p>
        </div>

        <button 
          onClick={()=>setShowNuevo(true)}
          className="border px-4 py-2 rounded-xl"
        >
          + Lote
        </button>
      </header>

      <main className="p-4">
        {lotes.length === 0 ? (
          <div className="text-center mt-20">
            <div className="text-5xl mb-4">🌾</div>
            <h2 className="font-semibold mb-2">Sin lotes todavía</h2>
            <p className="text-gray-500 mb-4">
              Creá tu primer lote
            </p>
            <button 
              onClick={()=>setShowNuevo(true)}
              className="border px-6 py-3 rounded-xl"
            >
              Crear lote
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {lotes.map(l=>(
              <div key={l.id} className="bg-white border rounded-xl p-4">
                <p className="font-semibold">{l.nombre}</p>
                <p className="text-sm text-gray-500">
                  {(l.animales||[]).length} animales
                </p>
              </div>
            ))}
          </div>
        )}
      </main>

      {showNuevo && (
        <NuevoLoteModal
          onClose={()=>setShowNuevo(false)}
          onSave={(nombre)=>{
            setLotes(prev=>[
              ...prev,
              {id:Date.now(), nombre, animales:[]}
            ]);
          }}
        />
      )}
    </div>
  );
}