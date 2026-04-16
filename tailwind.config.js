export default function Rodeo() {
  return (
    <div className="min-h-screen bg-[#f5f5f5] text-[#111]">
      
      {/* HEADER */}
      <div className="flex items-center justify-between px-4 py-4 border-b border-gray-200">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            🐄 Rodeo
          </h1>
          <p className="text-sm text-gray-500">
            0 animales · 0 lotes
          </p>
        </div>

        <button className="bg-white border border-gray-300 px-4 py-2 rounded-xl shadow-sm">
          + Lote
        </button>
      </div>

      {/* CONTENIDO VACÍO */}
      <div className="flex flex-col items-center justify-center text-center mt-24 px-6">
        
        <div className="text-5xl mb-4">🌾</div>

        <h2 className="text-lg font-semibold mb-2">
          Sin lotes todavía
        </h2>

        <p className="text-gray-500 mb-6">
          Creá tu primer lote para empezar
        </p>

        <button className="bg-white border border-gray-300 px-6 py-3 rounded-xl shadow-sm font-medium">
          + Crear primer lote
        </button>
      </div>

    </div>
  );
}