import { Link, Route, Routes } from 'react-router-dom';
import { Host } from './pages/Host';
import { Play } from './pages/Play';
import { PackPage, PrepHome } from './pages/Prep';
import { Swipe } from './pages/Swipe';
import { Tv } from './pages/Tv';

function Home() {
  return (
    <div className="home">
      <h1 className="brand" style={{ fontSize: '2.4rem' }}>
        Quizz <span>In</span>
      </h1>
      <p className="muted">Pick your screen.</p>
      <Link className="btn primary big" to="/tv">
        /tv  Main screen (TV)
      </Link>
      <Link className="btn big" to="/host">
        /host  Host remote
      </Link>
      <Link className="btn big" to="/prep">
        /prep  Question prep
      </Link>
      <Link className="btn big" to="/play">
        /play  Player
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
      <Route path="/prep/:id" element={<PackPage />} />
      <Route path="/prep/:id/swipe" element={<Swipe />} />
      <Route path="*" element={<Home />} />
    </Routes>
  );
}
