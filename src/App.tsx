import CesiumGlobe from './components/CesiumGlobe';

function App() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-black text-white font-sans">
      
      {/* Main 3D Container computes absolute geometry filling parent */}
      <main className="w-full h-full">
        <CesiumGlobe />
      </main>
    </div>
  );
}

export default App;
