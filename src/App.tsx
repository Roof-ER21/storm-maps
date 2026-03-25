import Sidebar from './components/Sidebar';
import StormMap from './components/StormMap';
import SearchBar from './components/SearchBar';
import Legend from './components/Legend';

function App() {
  return (
    <div className="h-full flex">
      <Sidebar />
      <main className="flex-1 relative flex flex-col">
        <SearchBar />
        <StormMap />
        <Legend />
      </main>
    </div>
  );
}

export default App;
