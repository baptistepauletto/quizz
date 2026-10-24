import { Link, Route, Routes } from 'react-router-dom';
import { Logo } from './components/Logo';
import { Host } from './pages/Host';
import { NightPage } from './pages/Night';
import { Play } from './pages/Play';
import { PilePage, PrepHome } from './pages/Prep';
import { Swipe } from './pages/Swipe';
import { Tv } from './pages/Tv';

function Home() {
  return (
    <div className="home">
      <h1 style={{ fontSize: '2.4rem' }}>
        <Logo />
      </h1>
      <p className="muted">Choisis ton écran.</p>
      <Link className="btn primary big" to="/tv">
        /tv · Écran TV
      </Link>
      <Link className="btn big" to="/host">
        /host · Télécommande
      </Link>
      <Link className="btn big" to="/prep">
        /prep · Préparer les questions
      </Link>
      <Link className="btn big" to="/play">
        /play · Joueur
      </Link>
    </div>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/tv" element={<Tv />} />
      <Route path="/host" element={<Host />} />
      <Route path="/play" element={<Play />} />
      <Route path="/prep" element={<PrepHome />} />
      <Route path="/prep/pile" element={<PilePage />} />
      <Route path="/prep/night" element={<NightPage />} />
      <Route path="/prep/swipe" element={<Swipe />} />
      <Route path="*" element={<Home />} />
    </Routes>
  );
}
